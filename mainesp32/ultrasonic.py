# ultrasonic.py
import machine
from machine import Pin, time_pulse_us
import time

# Constants
SOUND_SPEED_CM_PER_US = 0.0343  # Speed of sound in cm per microsecond (343 m/s / 10000)
# Using 29.1 for conversion (equivalent to 343 m/s / 2 / 10000 = 0.01715 cm/us, but 29.1 is commonly used)
DISTANCE_CONVERSION_FACTOR = 29.1  # Duration to distance conversion factor
DEFAULT_TIMEOUT_US = 30000  # 30ms timeout (max range ~500cm)
MIN_DISTANCE_CM = 2  # Minimum reliable distance for HC-SR04
MAX_DISTANCE_CM = 400  # Maximum reliable distance for HC-SR04


class UltrasonicSensor:
    """Ultrasonic sensor class for HC-SR04 or similar sensors.
    
    This class manages the trigger and echo pins for efficient reuse
    and provides methods for measuring distance with error handling.
    """
    
    def __init__(self, trig_pin, echo_pin, timeout_us=DEFAULT_TIMEOUT_US):
        """Initialize ultrasonic sensor with trigger and echo pins.
        
        Args:
            trig_pin: GPIO pin number for trigger
            echo_pin: GPIO pin number for echo
            timeout_us: Timeout in microseconds (default: 30000)
        """
        self.trig = machine.Pin(trig_pin, machine.Pin.OUT)
        self.echo = machine.Pin(echo_pin, machine.Pin.IN)
        self.timeout_us = timeout_us
    
    def measure_distance(self, validate=True):
        """Measure distance in centimeters using time_pulse_us (more efficient).
        
        This method uses MicroPython's built-in time_pulse_us() function which is
        more reliable and efficient than manual polling.
        
        Args:
            validate: If True, validate distance is within sensor range
            
        Returns:
            float: Distance in centimeters, or None if measurement fails
            
        Raises:
            ValueError: If distance is out of valid range (when validate=True)
        """
        # Ensure trigger is low initially
        self.trig.value(0)
        time.sleep_us(2)
        
        # Check if echo pin is already high (might indicate disconnected sensor)
        # Wait a bit to see if echo goes low first
        echo_check_start = time.ticks_us()
        while self.echo.value() == 1:
            if time.ticks_diff(time.ticks_us(), echo_check_start) > 1000:  # 1ms max wait
                # Echo pin stuck high - likely disconnected
                if validate:
                    raise Exception("Echo pin stuck high - sensor may be disconnected")
                return None
            time.sleep_us(10)
        
        # Send 10us trigger pulse
        self.trig.value(1)
        time.sleep_us(10)
        self.trig.value(0)
        
        # Use time_pulse_us to measure echo pulse duration
        # time_pulse_us(pin, pulse_level, timeout_us) waits for pin to reach pulse_level
        # Returns duration in microseconds, or -1 on timeout
        duration = time_pulse_us(self.echo, 1, self.timeout_us)
        
        if duration < 0:
            # Timeout - sensor may be disconnected or out of range
            if validate:
                raise Exception("Echo timeout - sensor may be disconnected or out of range")
            return None
        
        # Validate duration is reasonable (HC-SR04 minimum is ~58us for 1cm, ~116us for 2cm)
        # If duration is too small (< 100us), it's likely noise or disconnected sensor
        MIN_DURATION_US = 100  # Minimum valid duration (~1.7cm)
        if duration < MIN_DURATION_US:
            if validate:
                raise Exception("Duration too short ({}us) - sensor may be disconnected or malfunctioning".format(duration))
            return None
        
        # Calculate distance: (duration / 2) / 29.1
        # Divide by 2 because sound travels to object and back
        # 29.1 is the conversion factor (equivalent to speed of sound calculation)
        distance_cm = (duration / 2) / DISTANCE_CONVERSION_FACTOR
        
        # Validate distance range
        if validate:
            if distance_cm < MIN_DISTANCE_CM or distance_cm > MAX_DISTANCE_CM:
                raise ValueError(
                    "Distance out of range: {:.2f} cm (valid range: {}-{} cm)".format(
                        distance_cm, MIN_DISTANCE_CM, MAX_DISTANCE_CM
                    )
                )
        
        return distance_cm
    
    def measure_average(self, samples=5, validate=True):
        """Measure distance multiple times and return average.
        
        This helps reduce noise and improve accuracy by averaging multiple readings.
        Requires at least 50% of samples to be valid to return a result.
        
        Args:
            samples: Number of measurements to average (default: 5)
            validate: If True, validate measurements
            
        Returns:
            float: Average distance in centimeters, or None if insufficient valid readings
            
        Raises:
            Exception: If measurement fails and validate=True
        """
        readings = []
        failures = 0
        
        for _ in range(samples):
            try:
                distance = self.measure_distance(validate=False)  # Don't validate individual readings
                if distance is not None:
                    readings.append(distance)
                else:
                    failures += 1
                time.sleep_ms(50)  # 50ms delay between measurements (as per reference)
            except Exception as e:
                failures += 1
                # If validation is required and we have no readings, raise
                if validate and len(readings) == 0 and failures >= samples:
                    raise Exception("All measurements failed - sensor may be disconnected: {}".format(str(e)))
                # Otherwise, continue collecting valid readings
                continue
        
        # Require at least 50% of samples to be valid (prevents averaging with mostly invalid data)
        min_valid_samples = max(1, samples // 2)
        if len(readings) < min_valid_samples:
            if validate:
                raise Exception("Insufficient valid measurements ({}/{} valid) - sensor may be disconnected".format(
                    len(readings), samples
                ))
            return None
        
        # Return average of valid measurements
        return sum(readings) / len(readings)
    
    def measure_water_level(self, tank_height_cm, sensor_offset_cm=0, validate=True):
        """Measure actual water level in a tank (for top-mounted sensors).
        
        This method is designed for sensors mounted at the top of a tank/drum.
        It calculates: water_level = max(0, tank_height - distance)
        (sensor_offset is typically 0 if sensor is flush with tank top)
        
        Args:
            tank_height_cm: Total height of the tank/drum in centimeters
            sensor_offset_cm: Distance from tank top to sensor face (default: 0)
            validate: If True, validate the calculated water level is reasonable
            
        Returns:
            float: Actual water level in centimeters (0 = empty, tank_height = full), or None if measurement fails
            
        Raises:
            Exception: If measurement fails and validate=True
            ValueError: If calculated water level is invalid
        """
        distance = self.measure_distance(validate=False)  # Don't validate distance, handle None
        
        if distance is None:
            if validate:
                raise Exception("Failed to measure distance - sensor may be disconnected")
            return None
        
        # Calculate actual water level: water_level = tank_height - distance
        # Account for sensor offset (distance from tank top to sensor face)
        water_level = tank_height_cm - (distance + sensor_offset_cm)
        
        # Use max(0, ...) to ensure non-negative (as per reference code)
        water_level = max(0.0, water_level)
        
        # Validate water level is within reasonable bounds
        if validate:
            # Warn if water level exceeds tank height significantly (sensor may be too close)
            if water_level > tank_height_cm + 5:
                raise ValueError(
                    "Water level exceeds tank height: {:.2f} cm (tank height: {:.2f} cm)".format(
                        water_level, tank_height_cm
                    )
                )
        
        return water_level
    
    def measure_water_level_average(self, tank_height_cm, sensor_offset_cm=0, samples=5, validate=True):
        """Measure water level multiple times and return average.
        
        This provides more accurate readings by averaging multiple measurements.
        
        Args:
            tank_height_cm: Total height of the tank/drum in centimeters
            sensor_offset_cm: Distance from tank top to sensor face (default: 0)
            samples: Number of measurements to average (default: 5, as per reference)
            validate: If True, validate measurements
            
        Returns:
            float: Average water level in centimeters, or None if all measurements fail
            
        Raises:
            Exception: If measurement fails and validate=True
        """
        readings = []
        for _ in range(samples):
            try:
                water_level = self.measure_water_level(tank_height_cm, sensor_offset_cm, validate=False)
                if water_level is not None:
                    readings.append(water_level)
                time.sleep_ms(50)  # 50ms delay between measurements (as per reference)
            except Exception as e:
                if validate and len(readings) == 0:
                    raise
                continue
        
        if len(readings) == 0:
            if validate:
                raise Exception("No valid water level measurements obtained")
            return None
        
        return sum(readings) / len(readings)
    
    def calculate_percentage(self, water_level_cm, tank_height_cm):
        """Calculate water level as a percentage of tank capacity.
        
        Args:
            water_level_cm: Current water level in centimeters
            tank_height_cm: Total tank height in centimeters
            
        Returns:
            float: Water level percentage (0-100)
        """
        if tank_height_cm <= 0:
            return 0.0
        return (water_level_cm / tank_height_cm) * 100.0


# Backward compatibility function
def measure_distance(trig_pin, echo_pin, timeout_us=DEFAULT_TIMEOUT_US):
    """Measure distance using ultrasonic sensor (backward compatibility).
    
    This function maintains the original API for existing code.
    For better performance, consider using UltrasonicSensor class instead.
    
    Args:
        trig_pin: GPIO pin number for trigger
        echo_pin: GPIO pin number for echo
        timeout_us: Timeout in microseconds (default: 30000)
        
    Returns:
        float: Distance in centimeters
    """
    sensor = UltrasonicSensor(trig_pin, echo_pin, timeout_us)
    return sensor.measure_distance(validate=False)  # Don't validate for backward compatibility