"""Conservative safety checks for LightNAS management-network changes.

No action may bypass these restrictions by supplying an unreviewed client flag.
A proper host-owned, crash-safe timed rollback transaction must replace this
guard before immediate management-network edits are supported.
"""

PROTECTED_LIVE_ACTIONS = frozenset({
    "route-runtime-update",
    "device-disconnect",
    "connection-delete",
    "uplink-prefer",
})

ACTIVATION_ACTIONS = frozenset({
    "connection-update",
    "route-create",
    "route-delete",
    "route-update",
})


def require_safe_network_mutation(action: str, data: dict) -> None:
    """Refuse unprotected network cutovers before invoking any host command."""
    if action in PROTECTED_LIVE_ACTIONS:
        raise ValueError(
            f"{action} cannot be applied without verified timed network rollback; "
            "use a local console and an externally approved maintenance process."
        )
    # Permit only an explicit JSON boolean false. "false", 0, null and
    # other forged flag representations are never treated as an opt-out.
    if action in ACTIVATION_ACTIONS and "activate" in data and data["activate"] is not False:
        raise ValueError(
            f"{action} with immediate activation is unavailable until "
            "management connectivity verification and timed rollback exist."
        )
