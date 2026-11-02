"""Prepare MedTwin for the hospital network: make an HTTPS certificate for this computer (once)
and print the addresses doctors should open.

Called by start_network.bat. The certificate is self-signed, so each browser shows a warning the
first time; the connection is still encrypted. For a warning-free setup, ask hospital IT for a
certificate from their own certificate authority and save it as certs/medtwin.crt + .key.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import socket
import sys
from pathlib import Path

CERT_DIR = Path(__file__).resolve().parents[1] / "certs"
CERT, KEY = CERT_DIR / "medtwin.crt", CERT_DIR / "medtwin.key"
PORT = 8443


def lan_addresses() -> list[str]:
    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except socket.gaierror:
        pass
    try:  # the address used for outgoing traffic (no packet is sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in found if not a.startswith(("127.", "169.254.", "0.")))


def make_certificate(addresses: list[str]) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    host = socket.gethostname()
    names = [x509.DNSName(host), x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    names += [x509.IPAddress(ipaddress.ip_address(a)) for a in addresses]
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"MedTwin ({host})"),
                         x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MedTwin")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=730))
            .add_extension(x509.SubjectAlternativeName(names), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    CERT_DIR.mkdir(exist_ok=True)
    KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                      serialization.NoEncryption()))
    CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def certificate_covers(addresses: list[str]) -> bool:
    """True when the existing certificate names every current network address."""
    if not (CERT.is_file() and KEY.is_file()):
        return False
    from cryptography import x509
    cert = x509.load_pem_x509_certificate(CERT.read_bytes())
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:
        return False
    named = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
    expires = cert.not_valid_after_utc if hasattr(cert, "not_valid_after_utc") else cert.not_valid_after.replace(tzinfo=dt.timezone.utc)
    return set(addresses) <= named and expires > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7)


def main() -> int:
    addresses = lan_addresses()
    if not certificate_covers(addresses):
        make_certificate(addresses)
        print(f"Created an HTTPS certificate in {CERT_DIR} for {', '.join(addresses) or 'this computer'}")
    print()
    print("=" * 66)
    print(" MedTwin is starting for the hospital network")
    print("=" * 66)
    print(f" On this computer:      https://127.0.0.1:{PORT}")
    if addresses:
        for a in addresses:
            print(f" Doctors on the network: https://{a}:{PORT}")
    else:
        print(" No network address found: connect this computer to the hospital network.")
    print(f" Computer name:          https://{socket.gethostname()}:{PORT}")
    print()
    print(" First time only, in an Administrator Command Prompt, allow the port:")
    print(f'   netsh advfirewall firewall add rule name="MedTwin" dir=in action=allow protocol=TCP localport={PORT} profile=domain,private')
    print(" Browsers warn about the self-made certificate once: choose Advanced, then Continue.")
    print(" Stop the server with Ctrl + C.")
    print("=" * 66)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
