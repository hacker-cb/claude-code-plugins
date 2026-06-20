#!/usr/bin/env node
//
// hcb-dev SessionStart hook: inject the developer "house style" into every
// session. SessionStart adds stdout straight to the session context, so this
// wrapper just prints the rendered guidance. All logic lives in lib/prefs.mjs
// (unit-tested); this file only wires it to process.env / stdout.

import process from "node:process";
import { renderHouseStyle } from "../lib/prefs.mjs";

process.stdout.write(renderHouseStyle(process.env));
