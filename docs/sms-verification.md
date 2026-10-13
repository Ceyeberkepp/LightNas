# Retained SMS verification

SMS verification is disabled and hidden by default. Settings shows authenticator and passkey/security-key methods; SMS enrollment, phone inputs, delivery errors and sign-in choices are omitted. The SMS endpoints that enroll, verify, disable or send codes return 404 while the feature is off. Existing SMS enrollment data and delivery-service code are preserved, but SMS is not an active login factor. Authenticator and passkey factors remain active.

To restore the feature later, explicitly set `LIGHTNAS_SMS_ENABLED=1` in the LightNAS service environment and restart the service. A configured central gateway URL and appliance token are still required for SMS delivery. This flag alone does not configure a gateway or enable delivery. Existing saved SMS enrollments become active again when the feature is restored.
