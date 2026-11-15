"""Start the local analysis workspace from the project root."""
import sys

from server.cli import main


if __name__ == '__main__':
    sys.exit(main() or 0)
