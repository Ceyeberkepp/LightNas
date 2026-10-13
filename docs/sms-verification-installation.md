# One-click SMS verification provisioning

LightNAS sends verification texts through a centralized LightNAS SMS service. Appliances store only the central service URL and an appliance access token. Carrier, Twilio, modem and external SMS-provider credentials stay on the central delivery service.

The one-click installer installs the existing SMS verification client and provisions `/etc/lightnas/sms.env` on every installation/update. It preserves existing access settings, validates replacements, writes them atomically, applies root:lightnas ownership and mode 0640, and loads them into the restarted LightNAS service. The same installer installs/restarts the storage operation agent and its dependencies.

To enable SMS in a single install command, the service operator supplies a root-readable JSON provisioning file containing exactly:

```json
{
  "LIGHTNAS_SMS_GATEWAY_URL": "https://YOUR-CENTRAL-SMS-SERVICE",
  "LIGHTNAS_SMS_GATEWAY_TOKEN": "YOUR-APPLIANCE-ACCESS-TOKEN"
}
```

Use the real enrolled endpoint/token. Do not commit this file or paste its token into chat. Then run as root from the updated repository:

```bash
LIGHTNAS_SMS_PROVISION_FILE=/root/lightnas-sms-provision.json LIGHTNAS_REQUIRE_SMS=1 bash install.sh
```

An operator can also supply both settings as environment variables from their provisioning system. Partial pairs, unsafe values, non-HTTPS remote endpoints and provider credential fields in the provisioning JSON are rejected before replacing working SMS access. Loopback HTTP is permitted for a local development relay. Never run `source` on a provisioning file.

Without enrollment, installation reports **SMS verification pending**. It does not invent a service endpoint or token, launch a fake delivery service, or report that texts can be delivered. `LIGHTNAS_REQUIRE_SMS=1` makes missing enrollment an installer error. Configuration confirms client access settings only; verify end-to-end delivery through the authenticated phone setup screen.

A central gateway implementation and installer are available at `services/sms-gateway/server.mjs` and `scripts/install-sms-gateway.sh`. Deploy that on the operator's central service host, configure its actual delivery backend, expose it through HTTPS, and enroll an appliance token there. Installing an unconfigured gateway on each appliance does not enable SMS delivery. The appliance installer does not install a local modem/provider backend.

## Central service deployment through the same installer

Assign the central host the `sms-gateway` role:

```bash
LIGHTNAS_INSTALL_ROLE=sms-gateway bash install.sh
```

This installs Node.js and the central delivery server without installing NAS/container/VM services. The gateway config at `/etc/lightnas/sms-gateway.env` must contain enrolled appliance tokens and a real webhook delivery endpoint or modem backend. The installer creates the config template if needed and stops with a setup-required message until it is populated. It binds to loopback by default; expose the service through an HTTPS reverse proxy. The gateway operator configures delivery once; each appliance receives only its enrolled LightNAS access settings through the one-click installer.
