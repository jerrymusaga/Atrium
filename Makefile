.PHONY: ledger-build ledger-test frontend backend

ledger-build:        ## build the Daml package
	cd ledger && daml build

ledger-test:         ## run the DvP proof scripts
	cd ledger && daml test

frontend:            ## run the standalone demo UI (no LocalNet needed)
	cd frontend && npm install && npm run dev

backend:             ## run the executor stub
	cd backend && npm install && npm run dev
