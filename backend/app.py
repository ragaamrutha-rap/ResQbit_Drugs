from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import hashlib
import sqlite3
import os
from datetime import datetime
from PIL import Image
import numpy as np
import io
import colorsys
import hmac
from dotenv import load_dotenv
app = Flask(__name__)
CORS(app)

DB_PATH = 'tests.db'
load_dotenv()
SECRET_KEY = os.getenv('SIGNING_KEY', '').encode()
if not SECRET_KEY:
    raise RuntimeError('SIGNING_KEY is missing. Add it to backend/.env')

def compute_record_hash(prev_hash, timestamp, gps_lat, gps_lon, operator_id, image_hash, classification):
    payload = f"{prev_hash}|{timestamp}|{gps_lat}|{gps_lon}|{operator_id}|{image_hash}|{classification}"
    return hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()

def get_last_record_hash():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT record_hash FROM tests ORDER BY id DESC LIMIT 1')
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        return row[0]
    return '0' * 64  # genesis hash for the first record
def classify_test_result(image_bytes):
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    width, height = img.size
    img_array = np.array(img)

    # Reference card region: assume it's placed in the left third of the frame, center area
    ref_region = img_array[height//2 - 20:height//2 + 20, width//8:width//8 + 40]
    ref_avg_color = ref_region.reshape(-1, 3).mean(axis=0)

    # Test result region: assume it's placed in the right two-thirds, center area
    test_region = img_array[height//2 - 20:height//2 + 20, int(width*0.6):int(width*0.6) + 40]
    test_avg_color = test_region.reshape(-1, 3).mean(axis=0)

    # Lighting correction: scale test color based on how far the reference card
    # deviates from a known neutral gray (128,128,128)
    KNOWN_REF_COLOR = np.array([128.0, 128.0, 128.0])
    correction_factor = KNOWN_REF_COLOR / (ref_avg_color + 1e-6)
    corrected_test_color = test_avg_color * correction_factor
    corrected_test_color = np.clip(corrected_test_color, 0, 255)

    r, g, b = corrected_test_color / 255.0
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hue_degrees = h * 360

    # Simple threshold-based classification (placeholder ranges for prototype demo)
    if s < 0.15:
        result = "Inconclusive"
    elif 300 <= hue_degrees or hue_degrees <= 20:
        result = "Positive"
    elif 80 <= hue_degrees <= 180:
        result = "Negative"
    else:
        result = "Inconclusive"

    return {
        'result': result,
        'reference_color': ref_avg_color.tolist(),
        'test_color_raw': test_avg_color.tolist(),
        'test_color_corrected': corrected_test_color.tolist(),
        'hue_degrees': round(hue_degrees, 1)
    }

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            gps_lat REAL,
            gps_lon REAL,
            operator_id TEXT,
            image_hash TEXT,
            classification TEXT,
            prev_hash TEXT,
            record_hash TEXT
        )
    ''')
    conn.commit()
    conn.close()
@app.route('/upload', methods=['POST'])
def upload_test():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    image_file = request.files['image']
    operator_id = request.form.get('operator_id', 'unknown')
    lat = request.form.get('lat', '0')
    lon = request.form.get('lon', '0')

    image_bytes = image_file.read()
    image_hash = hashlib.sha256(image_bytes).hexdigest()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id FROM tests WHERE image_hash = ?', (image_hash,))
    existing = c.fetchone()
    conn.close()
    if existing:
        return jsonify({'error': f'This exact image was already recorded as test #{existing[0]}. Capture a fresh photo.'}), 409
    classification_data = classify_test_result(image_bytes)


    os.makedirs('uploads', exist_ok=True)
    filename = f"{image_hash}.jpg"
    filepath = os.path.join('uploads', filename)
    with open(filepath, 'wb') as f:
        f.write(image_bytes)

    timestamp = datetime.now().isoformat()
    prev_hash = get_last_record_hash()
    record_hash = compute_record_hash(prev_hash, timestamp, float(lat), float(lon), operator_id, image_hash, classification_data['result'])
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO tests (timestamp, gps_lat, gps_lon, operator_id, image_hash, classification, prev_hash, record_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (timestamp, float(lat), float(lon), operator_id, image_hash, classification_data['result'], prev_hash, record_hash))
    conn.commit()
    test_id = c.lastrowid
    conn.close()
    return jsonify({
        'id': test_id,
        'timestamp': timestamp,
        'image_hash': image_hash,
        'record_hash': record_hash,
        'classification': classification_data['result'],
        'debug_info': classification_data,
        'message': 'Test record created'
    })

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})
@app.route('/verify', methods=['GET'])
def verify_chain():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, timestamp, gps_lat, gps_lon, operator_id, image_hash, classification, prev_hash, record_hash FROM tests ORDER BY id ASC')
    rows = c.fetchall()
    conn.close()

    expected_prev = '0' * 64
    for row in rows:
        rec_id, ts, lat, lon, op, img_hash, cls, prev_hash, stored_hash = row
        if prev_hash != expected_prev:
            return jsonify({'valid': False, 'total_records': len(rows), 'broken_at_id': rec_id, 'reason': 'Chain link broken: previous hash does not match'})
        recomputed = compute_record_hash(prev_hash, ts, lat, lon, op, img_hash, cls)
        if recomputed != stored_hash:
            return jsonify({'valid': False, 'total_records': len(rows), 'broken_at_id': rec_id, 'reason': 'Record contents were altered'})
        expected_prev = stored_hash

    return jsonify({'valid': True, 'total_records': len(rows), 'broken_at_id': None, 'reason': 'All records verified'})
@app.route('/tests', methods=['GET'])
def list_tests():
    search = request.args.get('q', '').strip()
    result_filter = request.args.get('result', '').strip()

    query = 'SELECT id, timestamp, gps_lat, gps_lon, operator_id, image_hash, classification, record_hash FROM tests WHERE 1=1'
    params = []
    if search:
        query += ' AND (operator_id LIKE ? OR image_hash LIKE ? OR timestamp LIKE ?)'
        like = f'%{search}%'
        params.extend([like, like, like])
    if result_filter:
        query += ' AND classification = ?'
        params.append(result_filter)
    query += ' ORDER BY id DESC'

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(query, params)
    rows = c.fetchall()
    conn.close()

    tests = []
    for r in rows:
        tests.append({
            'id': r[0],
            'timestamp': r[1],
            'gps_lat': r[2],
            'gps_lon': r[3],
            'operator_id': r[4],
            'image_hash': r[5],
            'classification': r[6],
            'record_hash': r[7]
        })
    return jsonify({'tests': tests})

@app.route('/image/<image_hash>', methods=['GET'])
def get_image(image_hash):
    return send_from_directory('uploads', f'{image_hash}.jpg')
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)