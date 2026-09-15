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

export function digestState(state) {
  const text = stableStringify(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function createState({
  tick = 0,
  stockMilli = 0,
  ratePerTickMilli = 0,
  rulesVersion = DEFAULT_RULES.version,
  completions = [],
} = {}) {
  return {
    tick,
    stockMilli,
    ratePerTickMilli,
    recurringCount: 0,
    lastRecurringTickProcessed: 0,
    rulesVersion,
    completions: completions.map((item) => ({ ...item, applied: Boolean(item.applied) })),
    appliedCommands: {},
  };
}

function normalizeRules(rules = {}) {
  const merged = { ...DEFAULT_RULES, ...rules };
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

function validateCommands(commands) {
  for (const command of commands) {
    if (!command || typeof command.id !== "string" || command.id.length === 0) {
      throw new Error("invalid-command-id");
    }
    if (!Number.isSafeInteger(command.atTick) || command.atTick < 0) {
      throw new Error("invalid-command-tick");
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
      state.stockMilli += payload.amountMilli;
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
    state.recurringCount += 1;
    state.stockMilli += rules.recurringRewardMilli;
    state.lastRecurringTickProcessed = tick;
  }

  for (const completion of state.completions) {
    if (!completion.applied && completion.atTick === tick) {
      if (!Number.isSafeInteger(completion.rewardMilli)) {
        throw new Error("invalid-completion-reward");
      }
      state.stockMilli += completion.rewardMilli;
      completion.applied = true;
    }
  }

  const atTick = commands
    .filter((command) => command.atTick === tick)
    .sort((a, b) => a.id.localeCompare(b.id));

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

  if (state.rulesVersion !== actualRules.version) {
    throw new Error("rules-version-mismatch");
  }

  validateTarget(state, targetTick);
  validateCommands(commands);
  applyBoundary(state, state.tick, commands, actualRules);

  while (state.tick < targetTick) {
    state.stockMilli += state.ratePerTickMilli;
    state.tick += 1;
    applyBoundary(state, state.tick, commands, actualRules);
  }

  return state;
}

function nextRecurringAfter(tick, every) {
  return (Math.floor(tick / every) + 1) * every;
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

  if (state.rulesVersion !== actualRules.version) {
    throw new Error("rules-version-mismatch");
  }

  validateTarget(state, targetTick);
  validateCommands(commands);
  applyBoundary(state, state.tick, commands, actualRules);

  while (state.tick < targetTick) {
    const boundary = nextBoundary(state, targetTick, commands, actualRules);
    const delta = boundary - state.tick;
    state.stockMilli += state.ratePerTickMilli * delta;
    state.tick = boundary;
    applyBoundary(state, state.tick, commands, actualRules);
  }

  return state;
}

export function makeReceipt(state) {
  return {
    tick: state.tick,
    rulesVersion: state.rulesVersion,
    digest: digestState(state),
  };
}
