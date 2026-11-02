"""Reset a MedTwin account from the server computer: the way back in when the only
administrator has forgotten the password. Anyone who can run this already controls the server,
so no other check is needed. The reset is recorded in the security log.

    .venv\\Scripts\\python scripts\\reset_password.py --list
    .venv\\Scripts\\python scripts\\reset_password.py <username>
    .venv\\Scripts\\python scripts\\reset_password.py <username> --activate
    .venv\\Scripts\\python scripts\\reset_password.py --reset-all

A single reset prints a temporary password once; the doctor must choose a new one at the next
sign-in. --reset-all starts over when nobody can sign in: every account is moved to
data/account_archive/ (not destroyed), and the first-time setup screen appears again on this
computer. Cases, reports and logs are kept.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medtwin import config  # noqa: E402
from server.auth import AuthError, UserStore  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("username", nargs="?", help="account to reset")
    parser.add_argument("--list", action="store_true", help="list accounts")
    parser.add_argument("--activate", action="store_true", help="also re-activate a deactivated account")
    parser.add_argument("--reset-all", action="store_true", help="archive ALL accounts and show first-time setup again")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation question of --reset-all")
    args = parser.parse_args()
    store = UserStore(config.DATA_DIR)

    if args.reset_all:
        names = [u["username"] for u in store.list()]
        if not names:
            print("There are no accounts. Open MedTwin on this computer to create the administrator.")
            return 0
        print(f"This signs out everyone and removes all {len(names)} account(s): {', '.join(names)}")
        print("They are kept in data\\account_archive\\ and can be restored. Cases and reports stay.")
        if not args.yes and input("Type RESET to continue: ").strip() != "RESET":
            print("Cancelled.")
            return 1
        archived = store.archive_all(by="server-console")
        print(f"Done. Accounts archived to data\\account_archive\\{archived.name}")
        print("Next: on this computer open https://127.0.0.1:8443 (or http://127.0.0.1:8000),")
        print("create the new administrator on the First-time setup screen, then add the doctors under Users.")
        return 0

    if args.list or not args.username:
        accounts = store.list()
        if not accounts:
            print("No accounts yet. Open MedTwin on this computer to create the administrator.")
            return 0
        print(f"{'Username':<20}{'Role':<16}{'Status':<14}Name")
        for u in accounts:
            status = ("active" if u["active"] else "deactivated") + (" *reset asked" if u["reset_requested_at"] else "")
            print(f"{u['username']:<20}{u['role_label']:<16}{status:<14}{u['name']}")
        return 0

    try:
        if args.activate:
            store.update(args.username, by="server-console", active=True)
        temporary = store.admin_reset(args.username, by="server-console")
    except AuthError as exc:
        print(f"Error: {exc}")
        return 1
    print(f"Temporary password for {args.username}:  {temporary}")
    print("Give it to the doctor in person. They must choose a new password at the next sign-in.")
    print("If the account was locked after wrong passwords, wait 5 minutes or restart the server.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
