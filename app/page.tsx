'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Upload, AlertCircle, CheckCircle, XCircle, Cloud, Thermometer, Droplets, Wind } from 'lucide-react'

// Valid US ZIP code regex pattern
const ZIP_CODE_REGEX = /^\d{5}(-\d{4})?$/

// Function to validate ZIP code format
const isValidZipCode = (zip: string): boolean => {
  return ZIP_CODE_REGEX.test(zip.trim())
}

// Function to validate and clean ZIP codes
const validateAndCleanZipCodes = (zipCodes: string[]): { valid: string[], invalid: string[] } => {
  const valid: string[] = []
  const invalid: string[] = []
  
  zipCodes.forEach(zip => {
    const cleanZip = zip.trim()
    if (cleanZip && isValidZipCode(cleanZip)) {
      // Extract just the 5-digit ZIP code (remove +4 extension for API compatibility)
      const fiveDigitZip = cleanZip.split('-')[0]
      if (!valid.includes(fiveDigitZip)) {
        valid.push(fiveDigitZip)
      }
    } else if (cleanZip) {
      invalid.push(cleanZip)
    }
  })
  
  return { valid, invalid }
}

interface WeatherData {
  zip_code: string
  city: string
  date_time_utc: string
  temp_f: number
  temp_c: number
  feels_like_f: number
  feels_like_c: number
  humidity: number
  pressure_hpa: number
  wind_speed_mps: number
  wind_direction_deg: number
  cloud_cover_percent: number
  sunrise_utc: string
  sunset_utc: string
  weather_description: string
}

interface ProgressUpdate {
  type: 'progress' | 'error' | 'completed' | 'keepalive'
  current?: number
  total?: number
  zip_code?: string
  status?: string
  message?: string
}

export default function WeatherFetcher() {
  const [apiKey, setApiKey] = useState('')
  const [zipCodes, setZipCodes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentZip, setCurrentZip] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [weatherData, setWeatherData] = useState<WeatherData[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isCompleted, setIsCompleted] = useState(false)
  const [totalZips, setTotalZips] = useState(0)
  const [processedZips, setProcessedZips] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === 'text/csv') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const lines = text.split('\n')
        const zipCodesFromFile = lines
          .map(line => line.split(',')[0].trim())
          .filter(zip => zip && zip !== 'zip_code')
        
        setZipCodes(zipCodesFromFile.join('\n'))
      }
      reader.readAsText(file)
    }
  }

  const validateZipCodes = (zipString: string): { valid: string[], invalid: string[] } => {
    const zipArray = zipString
      .split(/[\n,\s]+/)
      .map(zip => zip.trim())
      .filter(zip => zip.length > 0)
    
    return validateAndCleanZipCodes(zipArray)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!apiKey.trim()) {
      setValidationErrors(['Please enter your OpenWeatherMap API key'])
      return
    }

    if (!zipCodes.trim()) {
      setValidationErrors(['Please enter ZIP codes'])
      return
    }

    // Validate ZIP codes
    const { valid: validZips, invalid: invalidZips } = validateZipCodes(zipCodes)
    
    if (invalidZips.length > 0) {
      setValidationErrors([
        `Invalid ZIP codes found: ${invalidZips.join(', ')}`,
        'Please use 5-digit ZIP codes (e.g., 12345 or 12345-6789)'
      ])
      return
    }

    if (validZips.length === 0) {
      setValidationErrors(['No valid ZIP codes found'])
      return
    }

    // Clear previous errors and data
    setValidationErrors([])
    setErrors([])
    setWeatherData([])
    setIsLoading(true)
    setIsCompleted(false)
    setProgress(0)
    setCurrentZip('')
    setTotalZips(validZips.length)
    setProcessedZips(0)

    try {
      const response = await fetch('http://127.0.0.1:5328/api/fetch-weather', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey.trim(),
          zip_codes: validZips
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      setSessionId(data.session_id)

      // Start listening for progress updates
      const eventSource = new EventSource(`http://127.0.0.1:5328/api/progress/${data.session_id}`)
      eventSourceRef.current = eventSource

      eventSource.onmessage = (event) => {
        const update: ProgressUpdate = JSON.parse(event.data)
        
        switch (update.type) {
          case 'progress':
            if (update.current !== undefined && update.total !== undefined) {
              const progressPercent = (update.current / update.total) * 100
              setProgress(progressPercent)
              setProcessedZips(update.current)
              setCurrentZip(update.zip_code || '')
            }
            break
          
          case 'error':
            if (update.zip_code && update.message) {
              setErrors(prev => [...prev, `${update.zip_code}: ${update.message}`])
            }
            break
          
          case 'completed':
            setIsCompleted(true)
            setIsLoading(false)
            setCurrentZip('')
            eventSource.close()
            
            // Fetch the results
            fetchResults(data.session_id)
            break
        }
      }

      eventSource.onerror = () => {
        setIsLoading(false)
        setErrors(prev => [...prev, 'Connection error occurred'])
        eventSource.close()
      }

    } catch (error) {
      setIsLoading(false)
      setErrors([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`])
    }
  }

  const fetchResults = async (sessionId: string) => {
    try {
      const response = await fetch(`http://127.0.0.1:5328/api/preview/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        setWeatherData(data.data || [])
      }
    } catch (error) {
      setErrors(prev => [...prev, 'Failed to fetch results'])
    }
  }

  const downloadCSV = () => {
    if (sessionId) {
      window.open(`http://127.0.0.1:5328/api/download/${sessionId}`, '_blank')
    }
  }

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString()
  }

  const formatWindDirection = (degrees: number) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    const index = Math.round(degrees / 22.5) % 16
    return `${directions[index]} (${degrees}°)`
  }

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Cloud className="h-8 w-8 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">Weather Data Fetcher</h1>
          </div>
          <p className="text-lg text-gray-600">
            Fetch weather data for multiple ZIP codes using OpenWeatherMap API
          </p>
        </div>

        {/* Input Form */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Configuration
            </CardTitle>
            <CardDescription>
              Enter your API key and ZIP codes to fetch weather data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">OpenWeatherMap API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={isLoading}
                />
                <p className="text-sm text-gray-500">
                  Get your free API key from{' '}
                  <a 
                    href="https://openweathermap.org/api" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    OpenWeatherMap
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="zipCodes">ZIP Codes</Label>
                <Textarea
                  id="zipCodes"
                  placeholder="Enter ZIP codes (one per line, comma-separated, or space-separated)&#10;Example:&#10;12345&#10;67890&#10;54321"
                  value={zipCodes}
                  onChange={(e) => setZipCodes(e.target.value)}
                  disabled={isLoading}
                  rows={6}
                />
                <div className="flex items-center gap-4">
                  <p className="text-sm text-gray-500">
                    Enter 5-digit US ZIP codes (e.g., 12345)
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="csvFile" className="text-sm cursor-pointer text-blue-600 hover:underline">
                      Or upload CSV file
                    </Label>
                    <Input
                      id="csvFile"
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      disabled={isLoading}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {validationErrors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Button 
                type="submit" 
                disabled={isLoading || !apiKey.trim() || !zipCodes.trim()}
                className="w-full"
              >
                {isLoading ? 'Fetching Weather Data...' : 'Fetch Weather Data'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Progress Section */}
        {isLoading && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5 animate-pulse" />
                Fetching Weather Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress: {processedZips} of {totalZips} ZIP codes</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="w-full" />
              </div>
              {currentZip && (
                <p className="text-sm text-gray-600">
                  Currently processing: <Badge variant="outline">{currentZip}</Badge>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Errors Section */}
        {errors.length > 0 && (
          <Card className="shadow-lg border-orange-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-700">
                <XCircle className="h-5 w-5" />
                Processing Errors
              </CardTitle>
              <CardDescription>
                Some ZIP codes could not be processed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {errors.map((error, index) => (
                  <Alert key={index} variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Section */}
        {isCompleted && weatherData.length > 0 && (
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Weather Data Results
                  </CardTitle>
                  <CardDescription>
                    Successfully fetched data for {weatherData.length} locations
                  </CardDescription>
                </div>
                <Button onClick={downloadCSV} className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ZIP Code</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Temperature</TableHead>
                      <TableHead>Feels Like</TableHead>
                      <TableHead>Humidity</TableHead>
                      <TableHead>Wind</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weatherData.slice(0, 10).map((data, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{data.zip_code}</TableCell>
                        <TableCell>{data.city}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Thermometer className="h-4 w-4 text-orange-500" />
                            {data.temp_f}°F ({data.temp_c}°C)
                          </div>
                        </TableCell>
                        <TableCell>{data.feels_like_f}°F ({data.feels_like_c}°C)</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Droplets className="h-4 w-4 text-blue-500" />
                            {data.humidity}%
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Wind className="h-4 w-4 text-gray-500" />
                            {(data.wind_speed_mps * 2.237).toFixed(1)} mph
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{data.weather_description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {weatherData.length > 10 && (
                <p className="text-sm text-gray-500 mt-4 text-center">
                  Showing first 10 results. Download CSV for complete data.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Completion Message */}
        {isCompleted && weatherData.length === 0 && errors.length === 0 && (
          <Card className="shadow-lg">
            <CardContent className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Processing Complete</h3>
              <p className="text-gray-600">No weather data was successfully retrieved.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}