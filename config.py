import os
from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = (os.getenv("DISCORD_TOKEN") or "").strip()
VERIFY_CHANNEL = (os.getenv("VERIFY_CHANNEL", "verify") or "").strip()
BELIEVER_CAMPAIGN_CHANNEL_ID = int(os.getenv("BELIEVER_CAMPAIGN_CHANNEL_ID", "1400787115008331868") or 0)
BELIEVER_PROOF_CHANNEL_ID = int(os.getenv("BELIEVER_PROOF_CHANNEL_ID", "1432842655704027259") or 0)
BELIEVER_ROLE_ID = int(os.getenv("BELIEVER_ROLE_ID", "1516725109941993532") or 0)
AUDIT_CHANNEL_ID = int(os.getenv("AUDIT_CHANNEL_ID", "1527375658014085292") or 0)
IMAGE_AUDIT_CHANNEL_ID = int(
    os.getenv("IMAGE_AUDIT_CHANNEL_ID", "1527375658014085292") or 0
)
AUDIT_TIMEZONE = (os.getenv("AUDIT_TIMEZONE", "Europe/Warsaw") or "Europe/Warsaw").strip()
AUDIT_WINNER_COUNT = int(os.getenv("AUDIT_WINNER_COUNT", "5") or 5)
AUDIT_MAX_RANGE_DAYS = int(os.getenv("AUDIT_MAX_RANGE_DAYS", "31") or 31)
AUDIT_MAX_MESSAGES = int(os.getenv("AUDIT_MAX_MESSAGES", "10000") or 10000)
AUDIT_MAX_BUFFER_MB = int(os.getenv("AUDIT_MAX_BUFFER_MB", "8") or 8)

# X OAuth2 Settings
X_CLIENT_ID = os.getenv("X_CLIENT_ID", "")
X_CLIENT_SECRET = os.getenv("X_CLIENT_SECRET", "")
X_REDIRECT_URI = os.getenv("X_REDIRECT_URI", "")
X_SCOPES = os.getenv("X_SCOPES", "users.read tweet.read")

# Callback Server Settings
OAUTH_HOST = os.getenv("OAUTH_HOST", "0.0.0.0")
OAUTH_PORT = os.getenv("OAUTH_PORT", "8000")
