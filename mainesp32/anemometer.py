# anemometer.py
import machine
import time

ANEMOMETER_PIN = 25  # Change as needed
pulse_count = 0
last_pulse_time = 0
DEBOUNCE_TIME_US = 1000  # Minimum time between pulses in microseconds (1ms debounce)

# Anemometer calibration constants
# Most cup anemometers produce 2 pulses per rotation (one per magnet pass)
PULSES_PER_ROTATION = 2
# Typical cup anemometer circumference in meters (adjust based on your sensor)
# Common values: 0.3-0.4m for small anemometers, 0.5-0.6m for larger ones
ANEMOMETER_CIRCUMFERENCE_M = 0.35  # meters - adjust this based on your anemometer specs
# Maximum reasonable wind speed (m/s) - cap readings above this as likely noise/error
MAX_WIND_SPEED_MS = 50.0  # 50 m/s = 180 km/h (hurricane force)
# Minimum wind speed threshold (m/s) - readings below this are considered noise/stuck sensor
MIN_WIND_SPEED_MS = 0.1  # 0.1 m/s = 0.36 km/h

def pulse_handler(pin):
    """Interrupt handler for anemometer pulses with debouncing."""
    global pulse_count, last_pulse_time
    current_time = time.ticks_us()
    # Debounce: ignore pulses that occur too quickly (likely noise)
    if time.ticks_diff(current_time, last_pulse_time) >= DEBOUNCE_TIME_US:
        pulse_count += 1
        last_pulse_time = current_time

def setup_anemometer():
    """
    Setup anemometer pin with interrupt.
    
    Note on voltage divider wiring:
    - With 2x 20k in parallel (10k) to pin and 10k to GND, you have a 50% divider
    - When sensor is HIGH (5V), pin sees ~2.5V (OK for ESP32)
    - When sensor is LOW (0V), pin sees 0V
    - Try PULL_DOWN or no pull resistor - PULL_UP might cause issues with voltage divider
    """
    # Try different pull configurations if you get false readings:
    # Option 1: No pull (voltage divider handles it)
    # pin = machine.Pin(ANEMOMETER_PIN, machine.Pin.IN)
    # Option 2: PULL_DOWN (helps ensure LOW state when sensor is off)
    # pin = machine.Pin(ANEMOMETER_PIN, machine.Pin.IN, machine.Pin.PULL_DOWN)
    # Option 3: PULL_UP (default, but may not work well with voltage divider)
    pin = machine.Pin(ANEMOMETER_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
    
    pin.irq(trigger=machine.Pin.IRQ_FALLING, handler=pulse_handler)
    print("Anemometer initialized on pin {} with debounce {}us".format(ANEMOMETER_PIN, DEBOUNCE_TIME_US))
    print("If getting constant readings, try: PULL_DOWN or no pull resistor (see setup_anemometer comments)")
    return pin

def test_anemometer_pin(pin=None, duration_sec=10):
    """
    Test function to check if anemometer pin is receiving pulses.
    Useful for debugging wiring issues.
    
    Args:
        pin: Pin object (if None, will create one)
        duration_sec: How long to monitor pulses
    
    Returns:
        Dictionary with test results
    """
    global pulse_count, last_pulse_time
    
    if pin is None:
        pin = machine.Pin(ANEMOMETER_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
    
    print("\n=== Anemometer Pin Test ({} seconds) ===".format(duration_sec))
    print("Monitoring pin {} for pulses...".format(ANEMOMETER_PIN))
    print("Current pin value: {}".format(pin.value()))
    
    pulse_count = 0
    last_pulse_time = time.ticks_us()
    start_time = time.time()
    
    # Monitor pin state changes
    last_state = pin.value()
    state_changes = 0
    
    while (time.time() - start_time) < duration_sec:
        current_state = pin.value()
        if current_state != last_state:
            state_changes += 1
            last_state = current_state
        time.sleep(0.01)  # Check every 10ms
    
    actual_duration = time.time() - start_time
    pulses_detected = pulse_count
    
    print("\nTest Results:")
    print("  Duration: {:.2f} seconds".format(actual_duration))
    print("  Pulses detected (via interrupt): {}".format(pulses_detected))
    print("  State changes (direct pin read): {}".format(state_changes))
    print("  Pulses per second: {:.2f}".format(pulses_detected / actual_duration if actual_duration > 0 else 0))
    print("  Final pin value: {}".format(pin.value()))
    
    if pulses_detected == 0 and state_changes == 0:
        print("\n  WARNING: No pulses detected! Check:")
        print("    - Is sensor rotating? (blow on it or place in wind)")
        print("    - Is wiring correct? (data wire to pin, voltage divider)")
        print("    - Is sensor powered? (5V and GND connected)")
    elif pulses_detected > 0 and state_changes == 0:
        print("\n  NOTE: Interrupts detected but no direct state changes - this is normal")
    elif state_changes > pulses_detected * 2:
        print("\n  WARNING: Many state changes but few interrupts - possible noise/bounce")
    
    return {
        'duration': actual_duration,
        'pulses': pulses_detected,
        'state_changes': state_changes,
        'pulses_per_sec': pulses_detected / actual_duration if actual_duration > 0 else 0
    }

def get_wind_speed(pulses, interval_sec):
    """
    Calculate wind speed from pulse count.
    
    Formula: Wind speed (m/s) = (pulses / pulses_per_rotation) * circumference / interval_sec
    
    Args:
        pulses: Number of pulses counted during the interval
        interval_sec: Measurement interval in seconds
    
    Returns:
        Wind speed in m/s, capped at MAX_WIND_SPEED_MS
    """
    if interval_sec <= 0:
        return 0.0
    
    if pulses == 0:
        return 0.0
    
    # Calculate rotations per second
    rotations_per_sec = (pulses / PULSES_PER_ROTATION) / interval_sec
    
    # Calculate wind speed: rotations/sec * circumference (m) = m/s
    wind_speed_ms = rotations_per_sec * ANEMOMETER_CIRCUMFERENCE_M
    
    # Cap at maximum reasonable value to filter out noise/interference
    if wind_speed_ms > MAX_WIND_SPEED_MS:
        print("Anemometer: Reading capped at {:.2f} m/s (raw: {:.2f} m/s, pulses: {})".format(
            MAX_WIND_SPEED_MS, wind_speed_ms, pulses))
        return MAX_WIND_SPEED_MS
    
    return wind_speed_ms

def measure_wind(interval_sec=5):
    """
    Measure wind speed over a specified interval.
    
    Args:
        interval_sec: Duration to measure in seconds
    
    Returns:
        Wind speed in m/s
    """
    global pulse_count, last_pulse_time
    pulse_count = 0
    last_pulse_time = time.ticks_us()
    start_time = time.time()
    
    time.sleep(interval_sec)
    
    actual_interval = time.time() - start_time
    pulses_detected = pulse_count
    wind_speed = get_wind_speed(pulses_detected, actual_interval)
    
    # Debug output
    pulses_per_sec = pulses_detected / actual_interval if actual_interval > 0 else 0
    print("Anemometer: {} pulses in {:.2f}s ({:.1f} pulses/s) -> {:.2f} m/s ({:.1f} km/h)".format(
        pulses_detected, actual_interval, pulses_per_sec, wind_speed, wind_speed * 3.6))
    
    # Check if sensor appears stuck (constant reading suggests no actual wind variation)
    if pulses_per_sec > 50:  # More than 50 pulses/sec suggests possible noise or stuck sensor
        print("Anemometer WARNING: High pulse rate ({:.1f} pulses/s) - check sensor connection and wiring".format(pulses_per_sec))
    
    return wind_speed