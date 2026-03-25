# gps.py
import machine  # type: ignore
import time

# GPS module typically uses UART
try:
    from machine import UART  # type: ignore
    UART_AVAILABLE = True
except ImportError:
    UART_AVAILABLE = False
    print("Warning: UART not available. GPS readings will be simulated.")


def setup_gps(uart_num=2, tx_pin=16, rx_pin=17, baudrate=9600):
    """
    Initialize GPS module on UART.
    Note: ESP32 TX pin connects to GPS RX, ESP32 RX pin connects to GPS TX.
    """
    if not UART_AVAILABLE:
        return None
    
    try:
        # Initialize UART for GPS communication
        # timeout=1000ms allows readline() to wait for complete sentences
        uart = UART(uart_num, baudrate=baudrate, tx=tx_pin, rx=rx_pin, timeout=1000)
        # Clear any stale data in the buffer
        if uart.any():
            uart.read(uart.any())  # Flush buffer
        print("GPS UART initialized: UART{}, TX={}, RX={}, Baud={}".format(
            uart_num, tx_pin, rx_pin, baudrate))
        return uart
    except Exception as e:
        print("GPS UART setup error: {}".format(e))
        return None


def convert_to_degrees(raw_value, direction):
    """
    Convert NMEA coordinate format to decimal degrees.
    Handles both latitude (DDMM.MMMM) and longitude (DDDMM.MMMM) formats.
    
    In NMEA format:
    - Latitude: "1234.5678" means 12 degrees, 34.5678 minutes (DDMM.MMMM)
    - Longitude: "12345.6789" means 123 degrees, 45.6789 minutes (DDDMM.MMMM)
    
    Args:
        raw_value: NMEA coordinate string (e.g., "1234.5678" for lat, "12345.6789" for lon)
        direction: Direction indicator ('N', 'S', 'E', 'W')
    
    Returns:
        Decimal degrees (negative for S/W), or None if invalid
    """
    if not raw_value or raw_value == '':
        return None
    
    try:
        # Determine if this is latitude or longitude based on direction
        # N/S = latitude (2 digits for degrees), E/W = longitude (3 digits for degrees)
        is_latitude = direction in ['N', 'S']
        
        # Find decimal point position
        dot_pos = raw_value.find('.')
        
        if dot_pos < 0:
            # No decimal point - treat entire string as integer part
            if is_latitude:
                # Latitude: DDMM format (2 digits for degrees)
                if len(raw_value) < 4:
                    return None
                degrees = float(raw_value[:2])
                minutes = float(raw_value[2:]) if len(raw_value) > 2 else 0.0
            else:
                # Longitude: DDDMM format (3 digits for degrees)
                if len(raw_value) < 5:
                    return None
                degrees = float(raw_value[:3])
                minutes = float(raw_value[3:]) if len(raw_value) > 3 else 0.0
        else:
            # Has decimal point
            if is_latitude:
                # Latitude: DDMM.MMMM format (2 digits for degrees)
                if dot_pos < 2:
                    return None
                degrees = float(raw_value[:2])
                minutes = float(raw_value[2:])  # Includes decimal part
            else:
                # Longitude: DDDMM.MMMM format (3 digits for degrees)
                if dot_pos < 3:
                    return None
                degrees = float(raw_value[:3])
                minutes = float(raw_value[3:])  # Includes decimal part
        
        # Convert to decimal degrees
        decimal = degrees + (minutes / 60.0)
        
        # Apply direction (negative for South and West)
        if direction in ['S', 'W']:
            decimal = -decimal
        
        return decimal
    except (ValueError, IndexError) as e:
        # Debug: uncomment to see conversion errors
        # print("GPS convert_to_degrees error: {} for value '{}' direction '{}'".format(e, raw_value, direction))
        return None


def parse_gpgga(sentence):
    """
    Parse $GPGGA NMEA sentence to extract latitude, longitude, and satellite count.
    
    Args:
        sentence: NMEA sentence string
    
    Returns:
        Tuple of (latitude, longitude, satellites) or (None, None, None) if invalid
    """
    if not sentence or not sentence.startswith('$GPGGA'):
        return None, None, None
    
    try:
        parts = sentence.split(',')
        if len(parts) < 9:
            return None, None, None
        
        # Check if we have valid coordinates (not empty)
        if parts[2] == '' or parts[4] == '':
            # Debug: GPS might not have a fix yet
            # print("GPS: No coordinates in sentence (no fix)")
            return None, None, None
        
        # Check fix quality (part 6: 0=no fix, 1=GPS fix, 2=DGPS fix)
        fix_quality = parts[6] if len(parts) > 6 else '0'
        if fix_quality == '0':
            # No fix - coordinates are invalid
            return None, None, None
        
        lat = convert_to_degrees(parts[2], parts[3])
        lon = convert_to_degrees(parts[4], parts[5])
        satellites = parts[7] if len(parts) > 7 and parts[7] != '' else None
        
        # Validate converted coordinates
        if lat is None or lon is None:
            return None, None, None
        
        # Validate coordinate ranges (sanity check)
        # Latitude: -90 to +90 degrees
        # Longitude: -180 to +180 degrees
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
            # Invalid coordinate range - likely parsing error
            # Debug: uncomment to see invalid coordinates
            # print("GPS: Invalid coordinate range - lat: {}, lon: {}".format(lat, lon))
            return None, None, None
        
        return lat, lon, satellites
    except Exception as e:
        # Debug: uncomment to see parsing errors
        # print("GPS parse_gpgga error:", e)
        return None, None, None


def parse_nmea_sentence(sentence):
    """
    Parse NMEA sentence to extract latitude and longitude.
    Maintains backward compatibility with existing code.
    """
    if not sentence or not sentence.startswith('$'):
        return None
    
    lat, lon, satellites = parse_gpgga(sentence)
    
    if lat is not None and lon is not None:
        result = {
            'latitude': round(lat, 6),
            'longitude': round(lon, 6)
        }
        if satellites is not None:
            try:
                result['satellites'] = int(satellites)
            except (ValueError, TypeError):
                pass
        return result
    
    return None


def read_gps(uart):
    """
    Read GPS coordinates from UART (non-blocking).
    Reads multiple lines to find a valid $GPGGA sentence.
    """
    if uart is None:
        # Return simulated values if GPS not available
        import random
        # Simulate Philippine coordinates
        return {
            'latitude': round(random.uniform(10.0, 20.0), 6),
            'longitude': round(random.uniform(120.0, 130.0), 6)
        }
    
    try:
        # Check if data is available (non-blocking)
        try:
            if not uart.any():
                return None
        except Exception:
            # UART might be in error state
            return None
        
        # Read multiple lines to find a $GPGGA sentence
        # GPS modules send multiple sentence types, so we need to check several lines
        max_lines = 10  # Read up to 10 lines to find a GPGGA sentence
        lines_read = 0
        
        while lines_read < max_lines:
            try:
                data = uart.readline()
                if not data:
                    # No more data available
                    break
                
                try:
                    # Decode with error handling
                    sentence = data.decode('utf-8').strip()
                    
                    # Debug: print raw sentence (can be removed later)
                    # print("GPS raw:", sentence[:50])  # Print first 50 chars
                    
                    if sentence.startswith('$GPGGA'):
                        result = parse_nmea_sentence(sentence)
                        if result:
                            return result
                        # If parse failed, continue to next line
                    # If not GPGGA, continue reading
                    
                except UnicodeDecodeError:
                    # Ignore decode errors (corrupted data)
                    pass
                except Exception as e:
                    # Log parsing errors for debugging
                    # print("GPS parse error:", e)
                    pass
                
                lines_read += 1
                
                # Check if more data is available
                if not uart.any():
                    break
                    
            except Exception:
                # Ignore read errors
                break
        
        # If no valid data, return None to indicate no fix
        return None
    except Exception:
        # Catch any other errors and return None (don't block)
        return None


def get_gps_coordinates(uart, timeout_seconds=5, debug=False):
    """
    Attempt to get GPS coordinates with timeout (non-blocking).
    Reads continuously until a valid fix is found or timeout expires.
    
    Args:
        uart: UART object
        timeout_seconds: Maximum time to wait for GPS fix
        debug: If True, print debug information about GPS reading
    """
    if uart is None:
        return None
    
    start_time = time.time()
    last_valid = None
    check_count = 0
    sentences_seen = 0
    # Check more frequently - GPS data comes in bursts
    max_checks = max(1, int(timeout_seconds * 10))  # Check 10 times per second
    
    if debug:
        print("GPS: Starting coordinate read (timeout: {}s)".format(timeout_seconds))
    
    while (time.time() - start_time) < timeout_seconds:
        try:
            # Check if UART has data
            if uart.any():
                # Try to read a raw sentence for debugging
                if debug and sentences_seen < 3:
                    try:
                        raw_data = uart.readline()
                        if raw_data:
                            try:
                                raw_sentence = raw_data.decode('utf-8', errors='ignore').strip()
                                if raw_sentence:
                                    print("GPS raw: {}".format(raw_sentence[:60]))
                                    sentences_seen += 1
                            except:
                                pass
                    except:
                        pass
                
                coords = read_gps(uart)
                check_count += 1
                if coords is not None:
                    last_valid = coords
                    # If we got a valid reading, return it immediately
                    if coords.get('latitude') and coords.get('longitude'):
                        if debug:
                            print("GPS: Got valid coordinates!")
                        return coords
        except Exception as e:
            if debug:
                print("GPS read error:", e)
            pass
        
        # Shorter sleep for more frequent checks (GPS sends data frequently)
        time.sleep(0.05)  # 50ms between checks
        
        # Safety: don't loop forever
        if check_count >= max_checks:
            break
    
    if debug and last_valid is None:
        print("GPS: No valid coordinates found within timeout")
    
    # Return last valid reading or None
    return last_valid

