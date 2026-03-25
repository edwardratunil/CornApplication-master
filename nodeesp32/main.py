# main.py
import time
import network  # type: ignore
import socket
import json
import machine  # type: ignore
import ubinascii  # type: ignore

try:
    import urequests as requests  # type: ignore
except ImportError:  # pragma: no cover - allow linting on desktop
    import requests  # type: ignore

from dht22 import setup_dht22, read_dht22
from gps import setup_gps, get_gps_coordinates

CONFIG_FILE = 'wifi_config.json'
AP_SSID = 'NodeESP32_Config_Portal'
AP_PASSWORD = '12345678'
AP_IP = '192.168.4.1'
PORT = 80

SERVER_SYNC_URL = ''
DEFAULT_SYNC_INTERVAL = 4  # seconds
DEFAULT_SENSOR_SAMPLE_INTERVAL = 6  # seconds
GPS_READ_INTERVAL = 2  # Read GPS every 2 seconds (GPS sends at 1Hz, so this gives time to accumulate)
GPS_READ_TIMEOUT = 3  # Allow 3 seconds to read GPS data (enough for multiple sentence cycles)

# Sensor pins - adjust these based on your hardware
DHT22_PIN = 19 # GPIO pin for DHT22 data
GPS_UART_NUM = 2
GPS_TX_PIN = 16
GPS_RX_PIN = 17

dht22_sensor = None
gps_uart = None
latest_gps_data = None  # Cache latest valid GPS coordinates
last_gps_read = 0  # Timestamp of last GPS read attempt


def http_post_json(url, payload):
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(payload)
    response = requests.post(url, data=data, headers=headers)  # type: ignore
    try:
        if response.status_code != 200:
            raise ValueError('HTTP {}'.format(response.status_code))
        return response.json()
    finally:
        response.close()


def perform_handshake(mac_address):
    payload = {
        'action': 'handshake',
        'mac_address': mac_address,
    }
    try:
        data = http_post_json(SERVER_SYNC_URL, payload)
    except Exception as exc:
        print('Handshake error:', exc)
        return False, DEFAULT_SYNC_INTERVAL

    authorized = bool(data.get('authorized'))
    interval = data.get('poll_interval') or DEFAULT_SYNC_INTERVAL
    message = data.get('message')
    if message:
        print('Server:', message)

    return authorized, int(interval)


def sync_with_server(mac_address, sensor_payload):
    payload = {
        'action': 'sync',
        'mac_address': mac_address,
        'timestamp': time.time(),
        'sensors': sensor_payload,
    }

    try:
        data = http_post_json(SERVER_SYNC_URL, payload)
    except Exception as exc:
        print('Sync error: {}'.format(exc))
        return False, None

    authorized = bool(data.get('authorized'))
    interval = data.get('poll_interval') or DEFAULT_SYNC_INTERVAL
    message = data.get('message')
    if message:
        print('Server: {}'.format(message))

    return authorized, int(interval)


def read_gps_background():
    """Read GPS coordinates in background and cache the result"""
    global latest_gps_data, last_gps_read
    
    if gps_uart is None:
        return
    
    try:
        # Read GPS with longer timeout to ensure we get valid data
        gps_data = get_gps_coordinates(gps_uart, timeout_seconds=GPS_READ_TIMEOUT)
        if gps_data and gps_data.get('latitude') and gps_data.get('longitude'):
            latest_gps_data = gps_data
            satellites = gps_data.get('satellites', 'N/A')
            print("GPS ✓ - Latitude: {:.6f}, Longitude: {:.6f}, Satellites: {}".format(
                gps_data.get('latitude', 0),
                gps_data.get('longitude', 0),
                satellites
            ))
        else:
            # No fix yet - keep previous data if available
            if latest_gps_data is None:
                print("GPS ⚠ - No fix yet (checking for GPS signal...)")
    except Exception as exc:
        # On error, keep previous data if available
        if latest_gps_data is None:
            print("GPS error: {}".format(str(exc)[:50]))
    
    last_gps_read = time.time()


def collect_sensor_payload():
    """Collect sensor data from DHT22 and GPS"""
    global latest_gps_data
    
    payload = {}

    # Read DHT22 (temperature and humidity)
    if dht22_sensor is not None:
        try:
            dht_data = read_dht22(dht22_sensor)
            payload['temperature_c'] = dht_data.get('temperature_c')
            payload['humidity_percent'] = dht_data.get('humidity_percent')
            
            # Show status indicator
            status = "✓" if dht_data.get('is_valid', False) else "⚠"
            sim_status = " (SIMULATED)" if dht_data.get('is_simulated', False) else ""
            print("DHT22 {} - Temperature: {:.2f}°C, Humidity: {:.2f}%{}".format(
                status,
                dht_data.get('temperature_c', 0),
                dht_data.get('humidity_percent', 0),
                sim_status
            ))
        except Exception as exc:
            print("DHT22 error:", exc)
    else:
        print("DHT22 sensor not available.")

    # Use cached GPS coordinates (read in background)
    if latest_gps_data and latest_gps_data.get('latitude') and latest_gps_data.get('longitude'):
        payload['latitude'] = latest_gps_data.get('latitude')
        payload['longitude'] = latest_gps_data.get('longitude')
        print("GPS (cached) - Latitude: {:.6f}, Longitude: {:.6f}".format(
            latest_gps_data.get('latitude', 0),
            latest_gps_data.get('longitude', 0)
        ))
    else:
        # No GPS fix available - send zero coordinates
        payload['latitude'] = 0.0
        payload['longitude'] = 0.0
        print("GPS ⚠ - No valid GPS data available, sending 0.0 coordinates")

    return payload


def save_credentials(ssid, password):
    with open(CONFIG_FILE, 'w') as f:
        json.dump({'ssid': ssid, 'password': password}, f)

def load_credentials():
    try:
        with open(CONFIG_FILE, 'r') as f:
            data = json.load(f)
            return data['ssid'], data['password']
    except:
        return None, None

def clear_credentials():
    try:
        import os
        os.remove(CONFIG_FILE)
    except:
        pass

def connect_wifi(ssid, password, timeout=15):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(ssid, password)
    for _ in range(timeout * 10):
        if wlan.isconnected():
            return True, wlan.ifconfig()[0]
        time.sleep(0.1)
    return False, None

def scan_networks():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    nets = wlan.scan()
    ssids = [net[0].decode() for net in nets]
    return ssids

def start_ap():
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid=AP_SSID, password=AP_PASSWORD)
    while not ap.active():
        time.sleep(0.1)
    return ap

def get_mac():
    wlan = network.WLAN(network.STA_IF)
    mac = ubinascii.hexlify(wlan.config('mac'), ':').decode()
    return mac

def serve_config_page(ssids, mac):
    options = ''.join(['<option value="{}">{}</option>'.format(s, s) for s in ssids])
    html = """<!DOCTYPE html>
<html>
<head>
<title>Node ESP32 Wi-Fi Setup</title>
<script>
function togglePassword() {{
  var pwd = document.getElementById('password');
  if (!pwd) return;
  if (pwd.type === 'password') {{
    pwd.type = 'text';
  }} else {{
    pwd.type = 'password';
  }}
}}
</script>
<style>
body {{
    background: #f6fff2;
    color: #2e4d1c;
    font-family: Arial, sans-serif;
    margin: 0; padding: 0;
}}
.container {{
    max-width: 350px;
    margin: 40px auto;
    background: #eafbe7;
    border-radius: 10px;
    box-shadow: 0 2px 8px #c7e6c1;
    padding: 24px;
}}
h2 {{
    text-align: center;
    color: #3a7d2c;
    margin-bottom: 12px;
}}
label {{
    display: block;
    margin-top: 12px;
    margin-bottom: 4px;
}}
select, input[type=password], input[type=text] {{
    width: 100%;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #b6d7a8;
    margin-bottom: 16px;
    box-sizing: border-box;
}}
input[type=submit] {{
    background: #5cb85c;
    color: white;
    border: none;
    padding: 10px;
    width: 100%;
    border-radius: 4px;
    font-size: 16px;
    cursor: pointer;
}}
input[type=submit]:hover {{
    background: #4cae4c;
}}
.mac {{
    font-size: 12px;
    color: #6c8e5b;
    text-align: center;
    margin-bottom: 16px;
}}
.checkbox-label {{
    font-size: 12px;
    display: flex;
    align-items: center;
    margin-top: 4px;
    margin-bottom: 12px;
}}
.checkbox-label input[type=checkbox] {{
    width: auto;
    margin-right: 6px;
    margin-bottom: 0;
}}
</style>
</head>
<body>
<div class="container">
    <h2>Node ESP32 Wi-Fi Setup</h2>
    <div class="mac">ESP32 MAC: {}</div>
    <form method="POST">
        <label for="ssid">Wi-Fi Network</label>
        <select name="ssid">{}</select>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Enter Wi-Fi password">
        <label class="checkbox-label">
            <input type="checkbox" onclick="togglePassword()">
            Show password
        </label>
        <input type="submit" value="Connect">
    </form>
</div>
</body>
</html>
""".format(mac, options)
    return html

def serve_message(msg):
    html = """<!DOCTYPE html>
<html>
<head><title>Node ESP32 Wi-Fi Config</title></head>
<body>
<h2>{}</h2>
</body>
</html>
""".format(msg)
    return html

def run_config_portal():
    ap = start_ap()
    mac = get_mac()
    addr = socket.getaddrinfo(AP_IP, PORT)[0][-1]
    s = socket.socket()
    s.bind(addr)
    s.listen(1)
    print("Config portal running at http://{}:{}/".format(AP_IP, PORT))
    while True:
        cl, addr = s.accept()
        req = cl.recv(1024).decode()
        if req.startswith('POST'):
            body = req.split('\r\n\r\n', 1)[-1]
            params = {}
            for pair in body.split('&'):
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    params[k] = v
            ssid = params.get('ssid', '').replace('+', ' ')
            password = params.get('password', '')
            save_credentials(ssid, password)
            cl.send('HTTP/1.0 200 OK\r\nContent-type: text/html\r\n\r\n')
            cl.send(serve_message("Configuration saved. Restarting..."))
            cl.close()
            time.sleep(2)
            machine.reset()
            return
        else:
            # Re-scan networks on each page load so new Wi-Fi APs appear when user refreshes
            ssids = scan_networks()
            cl.send('HTTP/1.0 200 OK\r\nContent-type: text/html\r\n\r\n')
            cl.send(serve_config_page(ssids, mac))
            cl.close()

def main_program(mac_address):
    global dht22_sensor, gps_uart, latest_gps_data, last_gps_read
    
    # Setup sensors
    try:
        dht22_sensor = setup_dht22(DHT22_PIN)
        if dht22_sensor:
            print("DHT22 sensor initialized on pin", DHT22_PIN)
        else:
            print("DHT22 sensor not available")
    except Exception as e:
        print("DHT22 setup error:", e)
        dht22_sensor = None

    try:
        gps_uart = setup_gps(GPS_UART_NUM, GPS_TX_PIN, GPS_RX_PIN)
        if gps_uart:
            print("GPS module initialized on UART", GPS_UART_NUM)
            # Start reading GPS immediately to begin acquiring fix
            print("Starting GPS acquisition...")
            read_gps_background()
        else:
            print("GPS module not available")
    except Exception as e:
        print("GPS setup error:", e)
        gps_uart = None

    authorized, sync_interval = perform_handshake(mac_address)
    sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
    last_sync = time.time() - sync_interval
    last_sensor_sample = time.time() - sensor_sample_interval
    last_handshake_attempt = time.time()
    last_heartbeat = time.time()
    latest_sensor_payload = {}
    latest_gps_data = None
    last_gps_read = 0

    if authorized:
        print("Device authorized by server.")
        print("Sensor sample interval: {}s, Sync interval: {}s, GPS read interval: {}s".format(
            sensor_sample_interval, sync_interval, GPS_READ_INTERVAL))
        print("Starting main loop...\n")

    while True:
        now = time.time()
        
        # Read GPS in background (separate from sensor reading)
        if gps_uart is not None and (now - last_gps_read) >= GPS_READ_INTERVAL:
            read_gps_background()
        
        # Heartbeat every 10 seconds to show loop is running
        if (now - last_heartbeat) >= 10:
            time_until_sensor = sensor_sample_interval - (now - last_sensor_sample)
            time_until_sync = sync_interval - (now - last_sync) if authorized else None
            time_until_gps = GPS_READ_INTERVAL - (now - last_gps_read) if gps_uart else None
            if time_until_sync is not None:
                gps_info = ", next GPS read in {:.1f}s".format(max(0, time_until_gps)) if time_until_gps is not None else ""
                print("Heartbeat - Next sensor read in {:.1f}s, next sync in {:.1f}s{}".format(
                    max(0, time_until_sensor), max(0, time_until_sync), gps_info))
            else:
                gps_info = ", next GPS read in {:.1f}s".format(max(0, time_until_gps)) if time_until_gps is not None else ""
                print("Heartbeat - Next sensor read in {:.1f}s{}".format(max(0, time_until_sensor), gps_info))
            last_heartbeat = now

        if (now - last_sensor_sample) >= sensor_sample_interval:
            print("\n--- Reading sensors (interval: {}s) ---".format(sensor_sample_interval))
            latest_sensor_payload = collect_sensor_payload()
            print("Sensor payload: {}".format(latest_sensor_payload))
            last_sensor_sample = time.time()

        if authorized and (now - last_sync) >= sync_interval:
            print("\n--- Syncing with server (interval: {}s) ---".format(sync_interval))
            print("Sending data: {}".format(latest_sensor_payload))
            success, new_interval = sync_with_server(mac_address, latest_sensor_payload)
            if success:
                sync_interval = new_interval or sync_interval
                sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
                last_sync = now
                print("✓ Sync successful. Next sync in {}s".format(sync_interval))
            else:
                print("✗ Sync denied for MAC {}. Re-handshaking...".format(mac_address))
                authorized = False
                last_handshake_attempt = now

        if not authorized and (now - last_handshake_attempt) >= 60:
            authorized, sync_interval = perform_handshake(mac_address)
            sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
            last_handshake_attempt = now
            if authorized:
                print("Device authorized by server.")
                last_sync = now - sync_interval
                last_sensor_sample = now - sensor_sample_interval
            else:
                print("Device not authorized yet. Waiting before retry.")

        time.sleep(0.5)

def boot():
    ssid, password = load_credentials()
    if ssid and password:
        print("Found saved Wi-Fi credentials. Connecting...")
        success, ip = connect_wifi(ssid, password, timeout=15)
        if success:
            print("Connected to Wi-Fi. IP: {}".format(ip))
            mac_address = get_mac()
            print("Device MAC address:", mac_address)
            main_program(mac_address)
        else:
            print("Wi-Fi connection failed. Clearing credentials and restarting...")
            clear_credentials()
            time.sleep(2)
            machine.reset()
    else:
        print("No Wi-Fi credentials found. Starting config portal...")
        run_config_portal()

boot()
