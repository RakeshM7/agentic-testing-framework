#!/usr/bin/env node
// The atf command (D-087): every former `make` target, on macOS, Windows and Linux. The logic is in
// scripts/lib/cli.mjs; `atf help` lists the commands.
import { main } from "../scripts/lib/cli.mjs";

process.exitCode = main(process.argv.slice(2));
