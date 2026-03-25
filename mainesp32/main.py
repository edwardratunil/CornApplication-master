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

try:
    import uwebsockets.client as websocket_client  # type: ignore
except ImportError:  # pragma: no cover - allow linting on desktop
    websocket_client = None  # type: ignore

from anemometer import setup_anemometer, measure_wind
from ultrasonic import UltrasonicSensor
from waterflow import setup_flow_sensor, measure_flow
from relay import relays, set_relay, get_all_relay_states

CONFIG_FILE = 'wifi_config.json'
AP_SSID = 'ESP32_Config_Portal'
AP_PASSWORD = '12345678'
AP_IP = '192.168.4.1'
PORT = 80

SERVER_SYNC_URL = 'https://cropmist.com/server/device_gateway.php'
DEFAULT_SYNC_INTERVAL = 2  # seconds
DEFAULT_RELAY_FETCH_INTERVAL = 1  # seconds
DEFAULT_SENSOR_SAMPLE_INTERVAL = 6  # seconds
SENSOR_SAMPLE_DURATION = 1  # seconds spent measuring wind/flow
HANDSHAKE_RETRY = 60  # seconds
WEBSOCKET_URL = 'wss://function-bun-production-0abb.up.railway.app/ws'
WEBSOCKET_TOKEN = 'cropmist-relay-secret-2025'
WEBSOCKET_RETRY = 5  # seconds between reconnect attempts

ws_client = None


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
        return False, DEFAULT_SYNC_INTERVAL, DEFAULT_RELAY_FETCH_INTERVAL

    authorized = bool(data.get('authorized'))
    interval = data.get('poll_interval') or DEFAULT_SYNC_INTERVAL
    relay_interval = data.get('relay_poll_interval') or DEFAULT_RELAY_FETCH_INTERVAL
    message = data.get('message')
    if message:
        print('Server:', message)

    return authorized, int(interval), int(relay_interval)


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
        print('Sync error:', exc)
        return False, None, None, None

    authorized = bool(data.get('authorized'))
    relay_states = data.get('relay_states')
    interval = data.get('poll_interval') or DEFAULT_SYNC_INTERVAL
    relay_interval = data.get('relay_poll_interval') or DEFAULT_RELAY_FETCH_INTERVAL
    message = data.get('message')
    if message:
        print('Server:', message)

    return authorized, relay_states, int(interval), int(relay_interval)


def fetch_relay_states(mac_address):
    payload = {
        'action': 'fetch_relays',
        'mac_address': mac_address,
    }

    try:
        data = http_post_json(SERVER_SYNC_URL, payload)
    except Exception as exc:
        print('Relay fetch error:', exc)
        return False, None, None

    authorized = bool(data.get('authorized'))
    relay_states = data.get('relay_states')
    interval = data.get('relay_poll_interval') or DEFAULT_RELAY_FETCH_INTERVAL
    message = data.get('message')
    if message:
        print('Server:', message)

    return authorized, relay_states, int(interval)


def close_websocket():
    global ws_client
    if ws_client is not None:
        try:
            ws_client.close()
        except Exception:
            pass
        ws_client = None


def connect_websocket(mac_address):
    global ws_client
    if websocket_client is None:
        return False

    close_websocket()

    url = '{}?mac={}&token={}'.format(
        WEBSOCKET_URL,
        mac_address.replace(':', '%3A'),
        WEBSOCKET_TOKEN
    )

    try:
        ws = websocket_client.connect(url)  # type: ignore
        try:
            ws.sock.settimeout(0)  # type: ignore[attr-defined]
        except Exception:
            pass
        ws_client = ws
        print('WebSocket connected')
        return True
    except Exception as exc:
        print('WebSocket connect failed:', exc)
        ws_client = None
        return False


def poll_websocket():
    global ws_client
    if ws_client is None:
        return

    try:
        message = ws_client.recv()
    except OSError as err:
        err_code = err.args[0] if err.args else None
        if err_code in (11, 110, 'timed out'):
            return
        print('WebSocket socket error:', err)
        close_websocket()
        return
    except Exception as exc:
        print('WebSocket recv error:', exc)
        close_websocket()
        return

    if not message:
        return

    try:
        data = json.loads(message)
    except Exception as exc:
        print('WebSocket payload error:', exc)
        return

    if data.get('type') == 'relay_update':
        relays_payload = data.get('relays')
        if isinstance(relays_payload, list):
            apply_relay_states(relays_payload)


def apply_relay_states(relay_states):
    """Apply relay states from server, ensuring Relay 3 is always OFF and Relay 4 follows logic."""
    if not isinstance(relay_states, (list, tuple)):
        return

    # Ensure we have 4 relay states
    while len(relay_states) < 4:
        relay_states.append(0)
    
    # Relay 3 is not used - always keep it OFF
    relay_states[2] = 0  # Relay 3 (index 2)
    
    # Relay 4 (Pump): Automatically ON when Relay 1 (water valve) or Relay 2 (pesticide valve) is ON
    # Override server value with correct logic
    relay_states[3] = 1 if (relay_states[0] == 1 or relay_states[1] == 1) else 0  # Relay 4 (index 3)

    for idx, state in enumerate(relay_states):
        if idx >= len(relays):
            break
        try:
            set_relay(idx, 1 if state else 0)
        except Exception as exc:
            print('Relay update error:', exc)

TRIG_WATER = 23
ECHO_WATER = 14
TRIG_PESTICIDE = 26
ECHO_PESTICIDE = 27

# Tank configuration - adjust these values based on your actual drum measurements
WATER_TANK_HEIGHT_CM = 87.0  # Total height of water tank/drum in cm (typical 55-gallon drum: 85-90 cm)
WATER_SENSOR_OFFSET_CM = 2.0  # Distance from tank top to sensor face in cm
PESTICIDE_TANK_HEIGHT_CM = 87.0  # Total height of pesticide tank/drum in cm
PESTICIDE_SENSOR_OFFSET_CM = 2.0  # Distance from tank top to sensor face in cm

def collect_sensor_payload(anemometer_ready, flow_sensor_ready, water_sensor=None, pesticide_sensor=None):
    payload = {}

    if anemometer_ready:
        try:
            wind_speed = measure_wind(SENSOR_SAMPLE_DURATION)
            print("Wind speed: {:.2f} m/s".format(wind_speed))
            payload['wind_speed_ms'] = wind_speed
        except Exception as exc:
            print("Anemometer error:", exc)
    else:
        print("Anemometer not available.")

    # Measure water level (actual water level, not distance)
    # Uses 5 samples for averaging (as per reference code) for better accuracy
    if water_sensor is not None:
        try:
            water_level = water_sensor.measure_water_level_average(
                WATER_TANK_HEIGHT_CM,
                WATER_SENSOR_OFFSET_CM,
                samples=5,  # 5 samples as per reference code
                validate=True
            )
            if water_level is not None:
                percent = (water_level / WATER_TANK_HEIGHT_CM) * 100.0
                print("Water Level: {:.1f} cm ({:.1f}%) | Tank height: {:.1f} cm".format(
                    water_level, percent, WATER_TANK_HEIGHT_CM
                ))
                payload['water_level_cm'] = water_level
            else:
                print("Water sensor: Failed to get reading - sensor may be disconnected")
                # Don't send invalid data to server
        except Exception as exc:
            print("Water sensor error (disconnected?):", exc)
            # Don't send invalid data to server when sensor is disconnected
    else:
        print("Water sensor not initialized.")

    # Measure pesticide level (actual level, not distance)
    # Uses 5 samples for averaging (as per reference code) for better accuracy
    if pesticide_sensor is not None:
        try:
            pesticide_level = pesticide_sensor.measure_water_level_average(
                PESTICIDE_TANK_HEIGHT_CM,
                PESTICIDE_SENSOR_OFFSET_CM,
                samples=5,  # 5 samples as per reference code
                validate=True
            )
            if pesticide_level is not None:
                percent = (pesticide_level / PESTICIDE_TANK_HEIGHT_CM) * 100.0
                print("Pesticide Level: {:.1f} cm ({:.1f}%) | Tank height: {:.1f} cm".format(
                    pesticide_level, percent, PESTICIDE_TANK_HEIGHT_CM
                ))
                payload['pesticide_level_cm'] = pesticide_level
            else:
                print("Pesticide sensor: Failed to get reading - sensor may be disconnected")
                # Don't send invalid data to server
        except Exception as exc:
            print("Pesticide sensor error (disconnected?):", exc)
            # Don't send invalid data to server when sensor is disconnected
    else:
        print("Pesticide sensor not initialized.")

    if flow_sensor_ready:
        try:
            flow_rate = measure_flow(SENSOR_SAMPLE_DURATION)
            print("Water Flow Rate: {:.2f} L/min".format(flow_rate))
            payload['water_flow_lpm'] = flow_rate
        except Exception as exc:
            print("Water flow error:", exc)
    else:
        print("Water flow sensor not available.")

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
    options = ''.join([f'<option value="{s}">{s}</option>' for s in ssids])
    html = f"""<!DOCTYPE html>
<html>
<head>
<title>Farm Wi-Fi Setup</title>
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
select, input[type=password] {{
    width: 100%;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #b6d7a8;
    margin-bottom: 16px;
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
</style>
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
</head>
<body>
<div class="container">
    <h2>Farm Wi-Fi Setup</h2>
    <div class="mac">ESP32 MAC: {mac}</div>
    <form method="POST">
        <label for="ssid">Wi-Fi Network</label>
        <select name="ssid">{options}</select>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Enter Wi-Fi password">
        <label style="font-size: 12px; display: flex; align-items: center; margin-top: 4px;">
            <input type="checkbox" style="margin-right: 6px;" onclick="togglePassword()">
            Show password
        </label>
        <input type="submit" value="Connect">
    </form>
</div>
</body>
</html>
"""
    return html

def serve_message(msg):
    html = f"""<!DOCTYPE html>
<html>
<head><title>ESP32 Wi-Fi Config</title></head>
<body>
<h2>{msg}</h2>
</body>
</html>
"""
    return html

def run_config_portal():
    ap = start_ap()
    mac = get_mac()
    addr = socket.getaddrinfo(AP_IP, PORT)[0][-1]
    s = socket.socket()
    s.bind(addr)
    s.listen(1)
    print(f"Config portal running at http://{AP_IP}:{PORT}/")
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
        else:
            # Re-scan networks on each page load so new Wi-Fi APs appear when user refreshes
            ssids = scan_networks()
            cl.send('HTTP/1.0 200 OK\r\nContent-type: text/html\r\n\r\n')
            cl.send(serve_config_page(ssids, mac))
            cl.close()

def main_program(mac_address):
    # Initialize all relays to OFF on startup
    # This ensures clean state regardless of previous state or database values
    print("Initializing relays to OFF state...")
    for idx in range(4):
        set_relay(idx, 0)
    print("All relays initialized to OFF")
    
    # Double-check Relay 4 is OFF (since Relay 1 and 2 are OFF, Relay 4 should be OFF)
    # This ensures the logical state matches the hardware state
    relay_states_check = get_all_relay_states()
    if relay_states_check[3] != 0:
        print("Fixing Relay 4 state (should be OFF when Relay 1 and 2 are OFF)...")
        set_relay(3, 0)
    
    # Setup sensors
    try:
        setup_anemometer()
        anemometer_ready = True
    except Exception as e:
        print("Anemometer setup error:", e)
        anemometer_ready = False

    try:
        setup_flow_sensor()
        flow_sensor_ready = True
    except Exception as e:
        print("Water flow sensor setup error:", e)
        flow_sensor_ready = False

    # Initialize ultrasonic sensors for water and pesticide level measurement
    try:
        water_sensor = UltrasonicSensor(TRIG_WATER, ECHO_WATER)
        print("Water level sensor initialized (tank height: {:.1f} cm)".format(WATER_TANK_HEIGHT_CM))
    except Exception as e:
        print("Water sensor initialization error:", e)
        water_sensor = None

    try:
        pesticide_sensor = UltrasonicSensor(TRIG_PESTICIDE, ECHO_PESTICIDE)
        print("Pesticide level sensor initialized (tank height: {:.1f} cm)".format(PESTICIDE_TANK_HEIGHT_CM))
    except Exception as e:
        print("Pesticide sensor initialization error:", e)
        pesticide_sensor = None

    authorized, sync_interval, relay_fetch_interval = perform_handshake(mac_address)
    sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
    last_sync = time.time() - sync_interval
    last_relay_fetch = time.time() - relay_fetch_interval
    last_sensor_sample = time.time() - sensor_sample_interval
    last_handshake_attempt = time.time()
    last_ws_attempt = 0
    latest_sensor_payload = {}

    if authorized:
        last_ws_attempt = time.time()
        if not connect_websocket(mac_address):
            last_ws_attempt = time.time()

    while True:
        now = time.time()

        if authorized and ws_client is None and (now - last_ws_attempt) >= WEBSOCKET_RETRY:
            if connect_websocket(mac_address):
                last_ws_attempt = time.time()
            else:
                last_ws_attempt = time.time()

        if authorized and (now - last_relay_fetch) >= relay_fetch_interval:
            success, relay_states, new_interval = fetch_relay_states(mac_address)
            if success:
                if isinstance(relay_states, list):
                    apply_relay_states(relay_states)
                    # Double-check Relay 4 state after applying (in case of any timing issues)
                    current_states = get_all_relay_states()
                    relay_4_should_be = 1 if (current_states[0] == 1 or current_states[1] == 1) else 0
                    if current_states[3] != relay_4_should_be:
                        set_relay(3, relay_4_should_be)
                    # Also ensure Relay 3 is OFF
                    if current_states[2] != 0:
                        set_relay(2, 0)
                relay_fetch_interval = new_interval or relay_fetch_interval
                last_relay_fetch = now
            else:
                print("Relay fetch denied for MAC {}. Re-handshaking...".format(mac_address))
                authorized = False
                last_handshake_attempt = now
                close_websocket()
                continue

        if (now - last_sensor_sample) >= sensor_sample_interval:
            latest_sensor_payload = collect_sensor_payload(anemometer_ready, flow_sensor_ready, water_sensor, pesticide_sensor)
            relay_states_snapshot = get_all_relay_states()
            # Enforce Relay 4 logic: ON only if Relay 1 or Relay 2 is ON
            # This ensures display matches the logical state, not just hardware state
            relay_4_logical = 1 if (relay_states_snapshot[0] == 1 or relay_states_snapshot[1] == 1) else 0
            # If hardware state doesn't match logical state, fix it
            if relay_states_snapshot[3] != relay_4_logical:
                set_relay(3, relay_4_logical)
                relay_states_snapshot[3] = relay_4_logical
            # Also ensure Relay 3 is OFF
            if relay_states_snapshot[2] != 0:
                set_relay(2, 0)
                relay_states_snapshot[2] = 0
            for idx, state in enumerate(relay_states_snapshot):
                print("Relay {} State: {}".format(idx + 1, "ON" if state else "OFF"))
            last_sensor_sample = time.time()

        if authorized and (now - last_sync) >= sync_interval:
            success, new_states, new_interval, new_relay_interval = sync_with_server(mac_address, latest_sensor_payload)
            if success:
                if isinstance(new_states, list):
                    apply_relay_states(new_states)
                    # Double-check Relay 4 state after applying (in case of any timing issues)
                    current_states = get_all_relay_states()
                    relay_4_should_be = 1 if (current_states[0] == 1 or current_states[1] == 1) else 0
                    if current_states[3] != relay_4_should_be:
                        set_relay(3, relay_4_should_be)
                    # Also ensure Relay 3 is OFF
                    if current_states[2] != 0:
                        set_relay(2, 0)
                sync_interval = new_interval or sync_interval
                relay_fetch_interval = new_relay_interval or relay_fetch_interval
                sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
                last_sync = now
                last_relay_fetch = now
            else:
                print("Sync denied for MAC {}. Re-handshaking...".format(mac_address))
                authorized = False
                last_handshake_attempt = now
                close_websocket()

        if not authorized and (now - last_handshake_attempt) >= HANDSHAKE_RETRY:
            authorized, sync_interval, relay_fetch_interval = perform_handshake(mac_address)
            sensor_sample_interval = max(DEFAULT_SENSOR_SAMPLE_INTERVAL, sync_interval)
            last_handshake_attempt = now
            if authorized:
                print("Device authorized by server.")
                last_sync = now - sync_interval
                last_relay_fetch = now - relay_fetch_interval
                last_sensor_sample = now - sensor_sample_interval
                last_ws_attempt = now
                if not connect_websocket(mac_address):
                    last_ws_attempt = now
            else:
                print("Device not authorized yet. Waiting before retry.")

        poll_websocket()
        time.sleep(0.2)

def boot():
    ssid, password = load_credentials()
    if ssid and password:
        print("Found saved Wi-Fi credentials. Connecting...")
        success, ip = connect_wifi(ssid, password, timeout=15)
        if success:
            print(f"Connected to Wi-Fi. IP: {ip}")
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