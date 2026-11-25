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