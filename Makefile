.PHONY: ledger-build ledger-test sandbox backend frontend frontend-live demo

ledger-build:        ## build the Daml package
	cd ledger && daml build

ledger-test:         ## run the privacy + DvP proof scripts
	cd ledger && daml test

sandbox:             ## run a local Canton ledger + JSON API on :7575, seeded with setupDemo (no Docker)
	cd ledger && daml start --sandbox-port 6865 --json-api-port 7575

backend:             ## run the executor against the JSON Ledger API on :7575 (needs `make sandbox`)
	cd backend && npm install && npm run dev

frontend:            ## run the standalone demo UI with the in-browser mock (no ledger needed)
	cd frontend && npm install && npm run dev

frontend-live:       ## run the demo UI against the live executor (needs `make sandbox` + `make backend`)
	cd frontend && npm install && VITE_LIVE=1 npm run dev

# Full live stack, in three terminals:
#   1) make sandbox     2) make backend     3) make frontend-live
demo: frontend          ## quickest path: the mock-backed demo UI
