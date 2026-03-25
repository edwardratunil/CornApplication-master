# waterflow.py
import machine
import time

FLOW_SENSOR_PIN = 32  # Change to your GPIO pin
pulse_count = 0

def pulse_handler(pin):
    global pulse_count
    pulse_count += 1

def setup_flow_sensor():
    pin = machine.Pin(FLOW_SENSOR_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
    pin.irq(trigger=machine.Pin.IRQ_FALLING, handler=pulse_handler)
    return pin

def get_flow_rate(pulses, interval_sec):
    # Example: YF-S201 gives 450 pulses per liter
    flow_rate = (pulses / 450) * (60 / interval_sec)
    return flow_rate

def measure_flow(interval_sec=5):
    global pulse_count
    pulse_count = 0
    time.sleep(interval_sec)
    return get_flow_rate(pulse_count, interval_sec)