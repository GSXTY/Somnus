"""Start the optional MCP bridge using the project's bundled dependencies."""
from event_detection.respiratory_mcp import mcp


if __name__ == '__main__':
    mcp.run(transport='stdio')
