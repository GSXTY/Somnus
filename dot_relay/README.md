# Somnus Dot relay

Run the experimental relay from the Somnus source directory with Python 3.12 or later. It uses FastAPI and Uvicorn from the main Python requirements.

```powershell
python -m dot_relay --database .\build\dot-relay\relay.sqlite3 --public-url http://127.0.0.1:8893 --port 8893 --local-dev
Invoke-RestMethod http://127.0.0.1:8893/healthz
python -B -m unittest dot_relay.test_relay
```

For hosted use, point an HTTPS reverse proxy at this service's separate loopback port. Set `--public-url` to the HTTPS origin advertised to ChatGPT and omit `--local-dev`. The connector URL is that origin followed by `/mcp`. Keep the database in a directory accessible only to the relay process and its operator. Configure throttling at the reverse proxy because requests proxied to the relay share the loopback peer address.

The desktop obtains a pairing code and the user enters it once on the ChatGPT connector's OAuth authorization page. In the dot, subscribe to `task.created` and ask it to call `read_task` with the event task ID and then call `submit_result` with the same ID. A valid subscription makes the desktop ready to send tasks.

The relay stores only the text explicitly handed off to Dot. The event carries a task ID and generic summary. The scoped Dot tool retrieves the task body by ID. The relay removes the prompt upon completion, expiry, or failed delivery. Result and error records are eligible for removal after one day. The relay does not access the desktop's conversation history, local files or company databases. Disconnecting the pair revokes both credentials and removes its relay records. A grace period applies to existing pending tool calls while paused.

The local test uses synthetic pairs and an in-process webhook. A stable public HTTPS endpoint and a ChatGPT connection are required to validate the hosted flow with a real dot.
