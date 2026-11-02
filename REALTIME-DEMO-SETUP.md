# Two-client real-time demo

Setup: see **README.md → Run in VS Code**. Start everything with `npm run dev:all`.

## Demo sequence
1. Open the Saathi app (http://localhost:5173) and the Mother Client (http://localhost:5174) side by side.
2. On the Mother Client tap **Enable alert sound and notifications**. Both should show the server as connected.
3. In Saathi press **SOS**. Mother's screen alerts instantly; Saathi's timeline shows "Alert delivered to Mum" (server receipt).
4. Watch the escalation countdown on the Live incident page. Let it expire to see automatic escalation, or press **Run escalation step**.
5. On the Mother Client press **I've received the alert**. Saathi shows the real acknowledgement and stops escalating.
6. Chat both ways (quick replies on Mother's side).
7. In Saathi press **Confirm I'm safe**. Mother's screen shows the incident is closed.

Try also: close the Mother Client before SOS (Saathi reports "stored, Mother offline"), then open it (the alert appears); stop the server (Saathi reports delivery failed).

Not for real emergencies. Restarting the server clears its in-memory state.
