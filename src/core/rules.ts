import type {
  RuleDefinition,
  RuleEvaluationResult,
  RuleOperator,
  RuleSeverityStatus,
  TelemetrySample,
} from './types.js';

function getMetricValue(sample: TelemetrySample, metric: RuleDefinition['metric']): number {
  switch (metric) {
    case 'cpu.usagePercent':
      return sample.cpu.usagePercent;
    case 'memory.usedPercent':
      return sample.memory.usedPercent;
  }
}

function compareValue(actual: number, operator: RuleOperator, threshold: number): boolean {
  switch (operator) {
    case 'gt':
      return actual > threshold;
    case 'gte':
      return actual >= threshold;
    case 'lt':
      return actual < threshold;
    case 'lte':
      return actual <= threshold;
  }
}

export function evaluateRule(rule: RuleDefinition, sample: TelemetrySample): RuleEvaluationResult {
  const actualValue = getMetricValue(sample, rule.metric);

  if (!rule.enabled) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      actualValue,
      status: 'ok',
      message: `${rule.name} rule disabled (${actualValue}%)`,
    };
  }

  let status: RuleSeverityStatus = 'ok';
  let thresholdBreached: number | undefined;

  if (compareValue(actualValue, rule.operator, rule.critical)) {
    status = 'critical';
    thresholdBreached = rule.critical;
  } else if (compareValue(actualValue, rule.operator, rule.warn)) {
    status = 'warn';
    thresholdBreached = rule.warn;
  }

  const message =
    status === 'ok'
      ? `${rule.name} healthy at ${actualValue}%`
      : `${rule.name} in ${status.toUpperCase()} state: ${actualValue}% (${rule.operator} ${thresholdBreached}%)`;

  const result: RuleEvaluationResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    metric: rule.metric,
    actualValue,
    status,
    message,
  };

  if (thresholdBreached !== undefined) {
    result.thresholdBreached = thresholdBreached;
  }

  return result;
}

export function evaluateRules(
  rules: RuleDefinition[],
  sample: TelemetrySample,
): RuleEvaluationResult[] {
  return rules.map((rule) => evaluateRule(rule, sample));
}

export function hasBreachedRules(evaluations: RuleEvaluationResult[]): boolean {
  return evaluations.some((item) => item.status === 'warn' || item.status === 'critical');
}

export interface RuleThresholdOverrides {
  warn?: number;
  critical?: number;
}

function validateThresholdNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid ${label} threshold "${value}". Must be a finite number between 0 and 100.`);
  }
  return value;
}

export function applyRuleOverrides(
  rules: RuleDefinition[],
  overrides: RuleThresholdOverrides,
): RuleDefinition[] {
  const hasWarn = overrides.warn !== undefined;
  const hasCritical = overrides.critical !== undefined;

  if (!hasWarn && !hasCritical) {
    return rules;
  }

  const nextWarn = hasWarn ? validateThresholdNumber(overrides.warn!, 'warn') : undefined;
  const nextCritical = hasCritical
    ? validateThresholdNumber(overrides.critical!, 'critical')
    : undefined;

  return rules.map((rule) => {
    const warn = nextWarn ?? rule.warn;
    const critical = nextCritical ?? rule.critical;

    if (
      (rule.operator === 'gt' || rule.operator === 'gte') &&
      warn > critical
    ) {
      throw new Error(
        `Rule "${rule.id}" warn threshold (${warn}) cannot exceed critical threshold (${critical}).`,
      );
    }

    return {
      ...rule,
      warn,
      critical,
    };
  });
}