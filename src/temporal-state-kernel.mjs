const DEFAULT_RULES = Object.freeze({
  version: "axm-global-state-proof-001",
  recurringEvery: 60,
  recurringRewardMilli: 7,
});

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function requireSafeInteger(value, code) {
  if (!Number.isSafeInteger(value)) throw new Error(code);
  return value;
}

function safeAdd(a, b, code = "integer-overflow") {
  requireSafeInteger(a, code);
  requireSafeInteger(b, code);
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

function safeMultiply(a, b, code = "integer-overflow") {
  requireSafeInteger(a, code);
  requireSafeInteger(b, code);
  const result = a * b;
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

function compareCanonicalText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function digestState(state) {
  const text = stableStringify(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

function validateState(state) {
  if (!state || typeof state !== "object") throw new Error("invalid-state");
  requireSafeInteger(state.tick, "invalid-state-tick");
  if (state.tick < 0) throw new Error("invalid-state-tick");
  requireSafeInteger(state.stockMilli, "invalid-state-stock");
  requireSafeInteger(state.ratePerTickMilli, "invalid-state-rate");
  requireSafeInteger(state.recurringCount, "invalid-state-recurring-count");
  requireSafeInteger(state.lastRecurringTickProcessed, "invalid-state-recurring-tick");
  if (typeof state.rulesVersion !== "string" || state.rulesVersion.length === 0) {
    throw new Error("invalid-state-rules-version");
  }
  if (!Array.isArray(state.completions)) throw new Error("invalid-state-completions");
  if (!state.appliedCommands || typeof state.appliedCommands !== "object" || Array.isArray(state.appliedCommands)) {
    throw new Error("invalid-state-applied-commands");
  }
  for (const completion of state.completions) {
    if (!completion || typeof completion !== "object") throw new Error("invalid-completion");
    if (typeof completion.id !== "string" || completion.id.length === 0) throw new Error("invalid-completion-id");
    requireSafeInteger(completion.atTick, "invalid-completion-tick");
    if (completion.atTick < 0) throw new Error("invalid-completion-tick");
    requireSafeInteger(completion.rewardMilli, "invalid-completion-reward");
    if (typeof completion.applied !== "boolean") throw new Error("invalid-completion-applied");
  }
}

export function createState({
  tick = 0,
  stockMilli = 0,
  ratePerTickMilli = 0,
  rulesVersion = DEFAULT_RULES.version,
  completions = [],
} = {}) {
  const state = {
    tick,
    stockMilli,
    ratePerTickMilli,
    recurringCount: 0,
    lastRecurringTickProcessed: 0,
    rulesVersion,
    completions: completions.map((item) => ({ ...item, applied: Boolean(item.applied) })),
    appliedCommands: {},
  };
  validateState(state);
  return state;
}

function normalizeRules(rules = {}) {
  const merged = { ...DEFAULT_RULES, ...rules };
  if (typeof merged.version !== "string" || merged.version.length === 0) {
    throw new Error("invalid-rules-version");
  }
  if (!Number.isSafeInteger(merged.recurringEvery) || merged.recurringEvery <= 0) {
    throw new Error("invalid-recurring-interval");
  }
  if (!Number.isSafeInteger(merged.recurringRewardMilli)) {
    throw new Error("invalid-recurring-reward");
  }
  return merged;
}

function validateTarget(state, targetTick) {
  if (!Number.isSafeInteger(targetTick) || targetTick < 0) {
    throw new Error("invalid-target-tick");
  }
  if (targetTick < state.tick) {
    throw new Error("time-cannot-move-backward");
  }
}

function commandFingerprint(command) {
  return stableStringify({
    id: command.id,
    atTick: command.atTick,
    type: command.type,
    payload: command.payload ?? {},
  });
}

function validateCommands(state, commands) {
  if (!Array.isArray(commands)) throw new Error("invalid-commands");
  for (const command of commands) {
    if (!command || typeof command.id !== "string" || command.id.length === 0) {
      throw new Error("invalid-command-id");
    }
    if (!Number.isSafeInteger(command.atTick) || command.atTick < 0) {
      throw new Error("invalid-command-tick");
    }
    if (typeof command.type !== "string" || command.type.length === 0) {
      throw new Error("invalid-command-type");
    }
    if (command.atTick < state.tick && state.appliedCommands[command.id] === undefined) {
      throw new Error(`unapplied-command-before-current-tick:${command.id}`);
    }
  }
}

function applyCommand(state, command) {
  const fingerprint = commandFingerprint(command);
  const prior = state.appliedCommands[command.id];

  if (prior !== undefined) {
    if (prior !== fingerprint) {
      throw new Error(`command-id-conflict:${command.id}`);
    }
    return;
  }

  const payload = command.payload ?? {};
  switch (command.type) {
    case "stock.add": {
      if (!Number.isSafeInteger(payload.amountMilli)) {
        throw new Error("invalid-stock-add");
      }
      state.stockMilli = safeAdd(state.stockMilli, payload.amountMilli, "stock-overflow");
      break;
    }
    case "rate.set": {
      if (!Number.isSafeInteger(payload.ratePerTickMilli)) {
        throw new Error("invalid-rate-set");
      }
      state.ratePerTickMilli = payload.ratePerTickMilli;
      break;
    }
    default:
      throw new Error(`unknown-command-type:${command.type}`);
  }

  state.appliedCommands[command.id] = fingerprint;
}

function applyBoundary(state, tick, commands, rules) {
  if (
    tick > 0 &&
    tick % rules.recurringEvery === 0 &&
    tick > state.lastRecurringTickProcessed
  ) {
    state.recurringCount = safeAdd(state.recurringCount, 1, "recurring-count-overflow");
    state.stockMilli = safeAdd(state.stockMilli, rules.recurringRewardMilli, "stock-overflow");
    state.lastRecurringTickProcessed = tick;
  }

  for (const completion of state.completions) {
    if (!completion.applied && completion.atTick === tick) {
      state.stockMilli = safeAdd(state.stockMilli, completion.rewardMilli, "stock-overflow");
      completion.applied = true;
    }
  }

  const atTick = commands
    .filter((command) => command.atTick === tick)
    .sort((a, b) => compareCanonicalText(a.id, b.id));

  for (const command of atTick) {
    applyCommand(state, command);
  }
}

export function advanceReference(
  inputState,
  targetTick,
  { commands = [], rules = {} } = {},
) {
  const state = clone(inputState);
  const actualRules = normalizeRules(rules);
  validateState(state);

  if (state.rulesVersion !== actualRules.version) {
    throw new Error("rules-version-mismatch");
  }

  validateTarget(state, targetTick);
  validateCommands(state, commands);
  applyBoundary(state, state.tick, commands, actualRules);

  while (state.tick < targetTick) {
    state.stockMilli = safeAdd(state.stockMilli, state.ratePerTickMilli, "stock-overflow");
    state.tick = safeAdd(state.tick, 1, "tick-overflow");
    applyBoundary(state, state.tick, commands, actualRules);
  }

  validateState(state);
  return state;
}

function nextRecurringAfter(tick, every) {
  const candidate = (Math.floor(tick / every) + 1) * every;
  return Number.isSafeInteger(candidate) ? candidate : Number.POSITIVE_INFINITY;
}

function nextBoundary(state, targetTick, commands, rules) {
  let next = targetTick;

  const recurring = nextRecurringAfter(state.tick, rules.recurringEvery);
  if (recurring < next) next = recurring;

  for (const completion of state.completions) {
    if (!completion.applied && completion.atTick > state.tick && completion.atTick < next) {
      next = completion.atTick;
    }
  }

  for (const command of commands) {
    if (
      state.appliedCommands[command.id] === undefined &&
      command.atTick > state.tick &&
      command.atTick < next
    ) {
      next = command.atTick;
    }
  }

  return next;
}

export function advanceCatchup(
  inputState,
  targetTick,
  { commands = [], rules = {} } = {},
) {
  const state = clone(inputState);
  const actualRules = normalizeRules(rules);
  validateState(state);

  if (state.rulesVersion !== actualRules.version) {
    throw new Error("rules-version-mismatch");
  }

  validateTarget(state, targetTick);
  validateCommands(state, commands);
  applyBoundary(state, state.tick, commands, actualRules);

  while (state.tick < targetTick) {
    const boundary = nextBoundary(state, targetTick, commands, actualRules);
    const delta = boundary - state.tick;
    const production = safeMultiply(state.ratePerTickMilli, delta, "stock-delta-overflow");
    state.stockMilli = safeAdd(state.stockMilli, production, "stock-overflow");
    state.tick = boundary;
    applyBoundary(state, state.tick, commands, actualRules);
  }

  validateState(state);
  return state;
}

export function makeReceipt(state) {
  validateState(state);
  return {
    tick: state.tick,
    rulesVersion: state.rulesVersion,
    digest: digestState(state),
  };
}
