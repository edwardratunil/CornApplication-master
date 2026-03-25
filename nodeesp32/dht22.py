# dht22.py
import machine  # type: ignore
import time

# DHT22 sensor library (you may need to install dht module via upip or use a custom implementation)
try:
    import dht  # type: ignore
    DHT_AVAILABLE = True
except ImportError:
    DHT_AVAILABLE = False
    print("Warning: dht module not available. DHT22 readings will be simulated.")

# Track last reading time - DHT22 needs at least 2 seconds between readings
_last_read_time = 0
_min_read_interval = 2.0  # seconds
_last_valid_reading = None


def setup_dht22(pin_number):
    """Initialize DHT22 sensor on specified pin"""
    if not DHT_AVAILABLE:
        print("DHT22: dht module not available. Using simulated values.")
        return None
    
    try:
        pin = machine.Pin(pin_number, machine.Pin.IN, machine.Pin.PULL_UP)
        sensor = dht.DHT22(pin)
        print("DHT22: Sensor initialized on pin {}".format(pin_number))
        # Test read to verify connection
        try:
            sensor.measure()
            temp = sensor.temperature()
            hum = sensor.humidity()
            if temp is not None and hum is not None:
                print("DHT22: Test read successful - Temp: {}°C, Hum: {}%".format(temp, hum))
            else:
                print("DHT22: Warning - Test read returned None values")
        except Exception as test_err:
            print("DHT22: Warning - Test read failed: {}".format(test_err))
            print("DHT22: Check wiring - Data pin should be connected to GPIO{}".format(pin_number))
            print("DHT22: DHT22 requires a 4.7k-10k pull-up resistor between VCC and DATA")
        return sensor
    except Exception as e:
        print("DHT22: Setup error on pin {}: {}".format(pin_number, e))
        return None


def read_dht22(sensor, retry_count=3):
    """Read temperature and humidity from DHT22 sensor with retry logic"""
    global _last_read_time, _last_valid_reading
    
    if sensor is None:
        # Return simulated values if sensor not available
        import random
        return {
            'temperature_c': round(random.uniform(20.0, 35.0), 2),
            'humidity_percent': round(random.uniform(40.0, 80.0), 2),
            'is_valid': False,
            'is_simulated': True
        }
    
    # Enforce minimum interval between readings
    current_time = time.time()
    time_since_last = current_time - _last_read_time
    if time_since_last < _min_read_interval:
        time.sleep(_min_read_interval - time_since_last)
    
    # Try reading with retries
    for attempt in range(retry_count):
        try:
            sensor.measure()
            temperature = sensor.temperature()
            humidity = sensor.humidity()
            
            # Validate readings
            if temperature is None or humidity is None:
                raise ValueError("Sensor returned None values")
            
            # DHT22 valid ranges: temp -40 to 80°C, humidity 0 to 100%
            if not (-40 <= temperature <= 80):
                raise ValueError("Temperature out of range: {}°C".format(temperature))
            if not (0 <= humidity <= 100):
                raise ValueError("Humidity out of range: {}%".format(humidity))
            
            # Success - update last read time and cache valid reading
            _last_read_time = time.time()
            reading = {
                'temperature_c': round(float(temperature), 2),
                'humidity_percent': round(float(humidity), 2),
                'is_valid': True,
                'is_simulated': False
            }
            _last_valid_reading = reading
            return reading
            
        except OSError as e:
            err_code = e.args[0] if e.args else None
            if err_code == 116:  # ETIMEDOUT
                if attempt < retry_count - 1:
                    print("DHT22: Timeout on attempt {}/{}, retrying...".format(attempt + 1, retry_count))
                    time.sleep(0.5)  # Wait before retry
                    continue
                else:
                    print("DHT22: Timeout after {} attempts".format(retry_count))
                    print("DHT22: Possible issues:")
                    print("  - Check wiring (DATA pin to GPIO, VCC to 3.3V, GND to GND)")
                    print("  - Verify pull-up resistor (4.7k-10k between VCC and DATA)")
                    print("  - Ensure sensor is powered and stable")
                    break
            else:
                print("DHT22: OSError {}: {}".format(err_code, e))
                break
        except Exception as e:
            print("DHT22: Read error (attempt {}): {}".format(attempt + 1, e))
            if attempt < retry_count - 1:
                time.sleep(0.5)
                continue
            break
    
    # All retries failed - return last valid reading or default
    if _last_valid_reading:
        print("DHT22: Using last valid reading due to read failure")
        result = _last_valid_reading.copy()
        result['is_valid'] = False
        return result
    else:
        print("DHT22: No valid reading available, using defaults")
        return {
            'temperature_c': 25.0,
            'humidity_percent': 50.0,
            'is_valid': False,
            'is_simulated': False
        }

