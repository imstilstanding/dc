from flask import Flask, request, jsonify, Response, send_file
from flask_cors import CORS
import requests
import csv
import io
import threading
import time
import uuid
from datetime import datetime, timezone
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import queue
import os
import traceback

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Global storage for sessions and progress
sessions = {}
progress_queues = {}

class WeatherFetcher:
    def __init__(self, api_key, zip_codes, session_id):
        self.api_key = api_key
        self.zip_codes = zip_codes
        self.session_id = session_id
        self.results = []
        self.progress_queue = queue.Queue()
        progress_queues[session_id] = self.progress_queue
        
    def fetch_weather_for_zip(self, zip_code):
        """Fetch weather data for a single ZIP code"""
        try:
            # OpenWeatherMap API endpoint
            url = f"http://api.openweathermap.org/data/2.5/weather"
            params = {
                'zip': f"{zip_code},US",
                'appid': self.api_key,
                'units': 'metric'  # Get Celsius, we'll convert to Fahrenheit
            }
            
            response = requests.get(url, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                
                # Extract weather data
                weather_data = {
                    'zip_code': zip_code,
                    'city': data['name'],
                    'date_time_utc': datetime.fromtimestamp(data['dt'], tz=timezone.utc).isoformat(),
                    'temp_f': round(data['main']['temp'] * 9/5 + 32, 1),
                    'temp_c': round(data['main']['temp'], 1),
                    'feels_like_f': round(data['main']['feels_like'] * 9/5 + 32, 1),
                    'feels_like_c': round(data['main']['feels_like'], 1),
                    'humidity': data['main']['humidity'],
                    'pressure_hpa': data['main']['pressure'],
                    'wind_speed_mps': data.get('wind', {}).get('speed', 0),
                    'wind_direction_deg': data.get('wind', {}).get('deg', 0),
                    'cloud_cover_percent': data.get('clouds', {}).get('all', 0),
                    'sunrise_utc': datetime.fromtimestamp(data['sys']['sunrise'], tz=timezone.utc).isoformat(),
                    'sunset_utc': datetime.fromtimestamp(data['sys']['sunset'], tz=timezone.utc).isoformat(),
                    'weather_description': data['weather'][0]['description']
                }
                
                return weather_data
            else:
                error_msg = f"API Error {response.status_code}"
                if response.status_code == 401:
                    error_msg = "Invalid API key"
                elif response.status_code == 404:
                    error_msg = "ZIP code not found"
                
                return {'error': error_msg, 'zip_code': zip_code}
                
        except requests.exceptions.Timeout:
            return {'error': 'Request timeout', 'zip_code': zip_code}
        except requests.exceptions.RequestException as e:
            return {'error': f'Network error: {str(e)}', 'zip_code': zip_code}
        except Exception as e:
            return {'error': f'Unexpected error: {str(e)}', 'zip_code': zip_code}
    
    def fetch_all_weather_data(self):
        """Fetch weather data for all ZIP codes using threading"""
        total_zips = len(self.zip_codes)
        completed = 0
        
        # Send initial progress
        self.progress_queue.put({
            'type': 'progress',
            'current': 0,
            'total': total_zips,
            'zip_code': 'Starting...',
            'status': 'processing'
        })
        
        # Use ThreadPoolExecutor for concurrent requests
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Submit all tasks
            future_to_zip = {
                executor.submit(self.fetch_weather_for_zip, zip_code): zip_code 
                for zip_code in self.zip_codes
            }
            
            # Process completed tasks
            for future in as_completed(future_to_zip):
                zip_code = future_to_zip[future]
                completed += 1
                
                try:
                    result = future.result()
                    
                    if 'error' in result:
                        # Send error progress update
                        self.progress_queue.put({
                            'type': 'error',
                            'zip_code': zip_code,
                            'message': result['error']
                        })
                    else:
                        self.results.append(result)
                    
                    # Send progress update
                    self.progress_queue.put({
                        'type': 'progress',
                        'current': completed,
                        'total': total_zips,
                        'zip_code': zip_code,
                        'status': 'completed'
                    })
                    
                except Exception as e:
                    self.progress_queue.put({
                        'type': 'error',
                        'zip_code': zip_code,
                        'message': f'Processing error: {str(e)}'
                    })
                
                # Rate limiting - small delay between requests
                time.sleep(0.1)
        
        # Send completion signal
        self.progress_queue.put({
            'type': 'completed',
            'current': completed,
            'total': total_zips,
            'message': f'Successfully processed {len(self.results)} out of {total_zips} ZIP codes'
        })
        
        # Store results in session
        sessions[self.session_id] = {
            'results': self.results,
            'completed_at': datetime.now().isoformat()
        }

# Add error handler
@app.errorhandler(Exception)
def handle_exception(e):
    # Log the error
    print(f"Error: {str(e)}")
    print(traceback.format_exc())
    
    return jsonify({
        'error': str(e),
        'type': type(e).__name__
    }), 500

# Update the fetch_weather route to include better error handling:
@app.route('/api/fetch-weather', methods=['POST'])
def fetch_weather():
    """Start weather fetching process"""
    try:
        print("Received fetch-weather request")
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
            
        data = request.get_json()
        print(f"Request data: {data}")
        
        api_key = data.get('api_key')
        zip_codes = data.get('zip_codes', [])
        
        if not api_key:
            return jsonify({'error': 'API key is required'}), 400
        
        if not zip_codes:
            return jsonify({'error': 'ZIP codes are required'}), 400
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        print(f"Created session: {session_id}")
        
        # Create weather fetcher
        fetcher = WeatherFetcher(api_key, zip_codes, session_id)
        
        # Start fetching in background thread
        thread = threading.Thread(target=fetcher.fetch_all_weather_data)
        thread.daemon = True
        thread.start()
        
        return jsonify({'session_id': session_id})
        
    except Exception as e:
        print(f"Error in fetch_weather: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/api/progress/<session_id>')
def progress_stream(session_id):
    """Server-sent events for progress updates"""
    def generate():
        if session_id not in progress_queues:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Session not found'})}\n\n"
            return
        
        progress_queue = progress_queues[session_id]
        
        while True:
            try:
                # Wait for progress update with timeout
                update = progress_queue.get(timeout=30)
                yield f"data: {json.dumps(update)}\n\n"
                
                # If completed, break the loop
                if update.get('type') == 'completed':
                    break
                    
            except queue.Empty:
                # Send keepalive
                yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                break
    
    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/download/<session_id>')
def download_csv(session_id):
    """Download CSV file with weather data"""
    if session_id not in sessions:
        return jsonify({'error': 'Session not found'}), 404
    
    results = sessions[session_id]['results']
    
    if not results:
        return jsonify({'error': 'No data available'}), 404
    
    # Create CSV in memory
    output = io.StringIO()
    fieldnames = [
        'zip_code', 'city', 'date_time_utc', 'temp_f', 'temp_c',
        'feels_like_f', 'feels_like_c', 'humidity', 'pressure_hpa',
        'wind_speed_mps', 'wind_direction_deg', 'cloud_cover_percent',
        'sunrise_utc', 'sunset_utc', 'weather_description'
    ]
    
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    
    for result in results:
        writer.writerow(result)
    
    # Convert to bytes
    csv_data = output.getvalue().encode('utf-8')
    output.close()
    
    # Create file-like object
    csv_file = io.BytesIO(csv_data)
    csv_file.seek(0)
    
    return send_file(
        csv_file,
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'weather-data-{datetime.now().strftime("%Y%m%d-%H%M%S")}.csv'
    )

@app.route('/api/preview/<session_id>')
def preview_data(session_id):
    """Get preview of weather data (first 5 results)"""
    if session_id not in sessions:
        return jsonify({'error': 'Session not found'}), 404
    
    results = sessions[session_id]['results']
    
    if not results:
        return jsonify({'error': 'No data available'}), 404
    
    # Return first 5 results for preview
    preview_results = results[:5]
    
    return jsonify({
        'data': preview_results,
        'total_results': len(results),
        'preview_count': len(preview_results)
    })

@app.route('/api/health')
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    app.run(debug=True, port=5328)
