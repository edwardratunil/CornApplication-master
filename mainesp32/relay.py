# relay.py
import machine  # type: ignore

# Define GPIO pins for the 4 relays
RELAY_PINS = [21, 22, 12, 19]  # Change these to your wiring
RELAY_ACTIVE_HIGH = False
RELAY_ON_LEVEL = 1 if RELAY_ACTIVE_HIGH else 0
RELAY_OFF_LEVEL = 0 if RELAY_ACTIVE_HIGH else 1

# Initialize relay pins to OFF
relays = [machine.Pin(pin, machine.Pin.OUT) for pin in RELAY_PINS]
for relay in relays:
    relay.value(RELAY_OFF_LEVEL)


def set_relay(channel: int, state: int) -> None:
    """
    Set relay state.
    channel: 0-3 (relay number)
    state: 0 (Off), 1 (On)
    """
    if 0 <= channel < len(relays):
        relays[channel].value(RELAY_ON_LEVEL if state else RELAY_OFF_LEVEL)
        return
    raise ValueError("Channel must be 0-3")


def get_relay_state(channel: int) -> int:
    if 0 <= channel < len(relays):
        return 1 if relays[channel].value() == RELAY_ON_LEVEL else 0
    raise ValueError("Channel must be 0-3")


def get_all_relay_states():
    return [get_relay_state(idx) for idx in range(len(relays))]