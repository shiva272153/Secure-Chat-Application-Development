import os
import smtplib
import ssl
import secrets
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formatdate, make_msgid
from config import Config


def generate_otp(length: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP."""
    digits = "0123456789"
    return "".join(secrets.choice(digits) for _ in range(length))


def build_otp_email_html(otp_code: str, username: str = "") -> str:
    """Build a modern, dark-themed responsive HTML verification email."""
    name_greeting = f"Hello {username}," if username else "Hello,"
    
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SecureChat Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0c0a13; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0c0a13; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #161324; border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);" cellpadding="0" cellspacing="0">
          
          <!-- Top Gradient Accent -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #8b5cf6, #06b6d4, #ec4899);"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 16px; text-align: center;">
              <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; font-size: 26px; border-radius: 12px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); text-align: center; margin-bottom: 12px;">
                🔐
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                SecureChat
              </h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #a1a1aa;">
                End-to-End Encrypted Communication
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="height: 1px; background: rgba(255, 255, 255, 0.08);"></div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 24px 32px 32px; text-align: center;">
              <p style="margin: 0 0 16px; font-size: 15px; color: #e4e4e7; text-align: left;">
                {name_greeting}
              </p>
              <p style="margin: 0 0 24px; font-size: 14px; color: #a1a1aa; line-height: 1.6; text-align: left;">
                Use the following 6-digit verification code to complete your registration. This code ensures only you have access to your SecureChat identity.
              </p>

              <!-- OTP Code Display Card -->
              <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 20px 10px; margin: 0 auto 24px; text-align: center;">
                <span style="font-family: 'SF Mono', Monaco, Menlo, 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #a78bfa; display: inline-block;">
                  {otp_code}
                </span>
              </div>

              <p style="margin: 0 0 8px; font-size: 13px; color: #71717a;">
                ⏳ This code is valid for <strong>{Config.OTP_EXPIRY_MINUTES} minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                If you did not request this verification code, please ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: rgba(0, 0, 0, 0.25); padding: 16px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05);">
              <p style="margin: 0; font-size: 11px; color: #71717a;">
                Protected with client-side RSA-2048 & AES-256-GCM encryption.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _send_smtp_email(to_email: str, subject: str, html_content: str, text_content: str):
    """Internal helper to execute SMTP sending."""
    server = os.getenv("MAIL_SERVER", Config.MAIL_SERVER)
    port = int(os.getenv("MAIL_PORT", str(Config.MAIL_PORT)))
    username = os.getenv("MAIL_USERNAME", Config.MAIL_USERNAME)
    password = os.getenv("MAIL_PASSWORD", Config.MAIL_PASSWORD)
    sender = os.getenv("MAIL_DEFAULT_SENDER", Config.MAIL_DEFAULT_SENDER) or username
    sender = sender.strip('"\'')

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="gmail.com")
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Mailer"] = "SecureChat Mailer 1.0"

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        context = ssl.create_default_context()
        use_tls = os.getenv("MAIL_USE_TLS", "true").lower() in ("true", "1", "yes")
        if use_tls:
            with smtplib.SMTP(server, port, timeout=15) as smtp:
                smtp.starttls(context=context)
                smtp.login(username, password)
                smtp.sendmail(username, to_email, msg.as_string())
        else:
            with smtplib.SMTP_SSL(server, port, context=context, timeout=15) as smtp:
                smtp.login(username, password)
                smtp.sendmail(username, to_email, msg.as_string())
        print(f"[+] Email OTP sent successfully to {to_email}", flush=True)
        return True
    except Exception as e:
        print(f"[!] Failed to send email via SMTP to {to_email}: {e}", flush=True)
        return False


def send_otp_email(to_email: str, otp_code: str, username: str = "", async_send: bool = True) -> bool:
    """
    Send a 6-digit OTP verification code to the target email.
    If Gmail credentials are not configured yet, logs the OTP to console for seamless development.
    """
    # Professional subject without OTP code numbers to prevent spam filtering
    subject = "Verify your SecureChat account"
    text_content = (
        f"Hello {username},\n\n"
        f"Your SecureChat verification code is: {otp_code}\n"
        f"This code will expire in {Config.OTP_EXPIRY_MINUTES} minutes.\n\n"
        f"If you did not request this, please ignore this email.\n"
    )
    html_content = build_otp_email_html(otp_code, username)

    # Check if Gmail credentials are provided
    mail_user = os.getenv("MAIL_USERNAME", Config.MAIL_USERNAME)
    mail_pass = os.getenv("MAIL_PASSWORD", Config.MAIL_PASSWORD)
    if not mail_user or not mail_pass or "your-email" in mail_user:
        # Developer fallback: log prominently to console
        print("\n" + "=" * 60, flush=True)
        print(f"📧 [DEV EMAIL OTP] To: {to_email}", flush=True)
        print(f"🔐 VERIFICATION CODE: {otp_code}", flush=True)
        print(f"⏳ Valid for {Config.OTP_EXPIRY_MINUTES} minutes", flush=True)
        print("💡 To send real Gmail emails, configure MAIL_USERNAME and MAIL_PASSWORD in your .env", flush=True)
        print("=" * 60 + "\n", flush=True)
        return True

    if async_send:
        # Send in a background thread so the user doesn't experience network latency
        thread = threading.Thread(
            target=_send_smtp_email,
            args=(to_email, subject, html_content, text_content),
            daemon=True
        )
        thread.start()
        return True
    else:
        return _send_smtp_email(to_email, subject, html_content, text_content)
