// ============================================================================
// MAERMIN v6.0 - Goal-Based Investing Engine
// Multiple investment goals with tracking, projections, and recommendations
// ============================================================================

/**
 * Goal types with default configurations
 */
const GOAL_TYPES = {
  retirement: {
    name: 'Retirement',
    defaultTimeframe: 30,
    riskProfile: 'moderate',
    suggestedAllocation: { stocks: 70, bonds: 25, cash: 5 }
  },
  house: {
    name: 'House Down Payment',
    defaultTimeframe: 5,
    riskProfile: 'conservative',
    suggestedAllocation: { stocks: 40, bonds: 40, cash: 20 }
  },
  education: {
    name: 'Education Fund',
    defaultTimeframe: 18,
    riskProfile: 'moderate',
    suggestedAllocation: { stocks: 60, bonds: 30, cash: 10 }
  },
  emergency: {
    name: 'Emergency Fund',
    defaultTimeframe: 1,
    riskProfile: 'conservative',
    suggestedAllocation: { stocks: 0, bonds: 20, cash: 80 }
  },
  vacation: {
    name: 'Vacation Fund',
    defaultTimeframe: 2,
    riskProfile: 'conservative',
    suggestedAllocation: { stocks: 20, bonds: 40, cash: 40 }
  },
  car: {
    name: 'New Car',
    defaultTimeframe: 3,
    riskProfile: 'conservative',
    suggestedAllocation: { stocks: 30, bonds: 40, cash: 30 }
  },
  wedding: {
    name: 'Wedding Fund',
    defaultTimeframe: 2,
    riskProfile: 'conservative',
    suggestedAllocation: { stocks: 20, bonds: 30, cash: 50 }
  },
  business: {
    name: 'Start a Business',
    defaultTimeframe: 5,
    riskProfile: 'moderate',
    suggestedAllocation: { stocks: 50, bonds: 30, cash: 20 }
  },
  custom: {
    name: 'Custom Goal',
    defaultTimeframe: 10,
    riskProfile: 'moderate',
    suggestedAllocation: { stocks: 60, bonds: 30, cash: 10 }
  }
};

/**
 * Create a new investment goal
 * @param {Object} config - Goal configuration
 */
function createGoal(config) {
  const {
    name,
    type = 'custom',
    targetAmount,
    currentAmount = 0,
    deadline,
    monthlyContribution = 0,
    priority = 'medium',
    notes = ''
  } = config;

  const goalType = GOAL_TYPES[type] || GOAL_TYPES.custom;
  const targetDate = deadline ? new Date(deadline) : null;
  const monthsRemaining = targetDate ? 
    Math.max(0, (targetDate - new Date()) / (1000 * 60 * 60 * 24 * 30)) : 
    goalType.defaultTimeframe * 12;

  return {
    id: 'goal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    name: name || goalType.name,
    type: type,
    targetAmount: targetAmount,
    currentAmount: currentAmount,
    deadline: deadline,
    monthlyContribution: monthlyContribution,
    priority: priority,
    notes: notes,
    riskProfile: goalType.riskProfile,
    suggestedAllocation: goalType.suggestedAllocation,
    monthsRemaining: monthsRemaining,
    createdAt: new Date().toISOString()
  };
}

/**
 * Calculate goal progress and projections
 * @param {Object} goal - Goal object
 * @param {Object} config - Calculation config
 */
function calculateGoalProgress(goal, config) {
  const {
    expectedReturn = 0.07,
    inflationRate = 0.02
  } = config || {};

  const currentAmount = goal.currentAmount || 0;
  const targetAmount = goal.targetAmount || 0;
  const monthlyContribution = goal.monthlyContribution || 0;
  const monthsRemaining = goal.monthsRemaining || 120;

  // Basic progress
  const progressPercent = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;
  const amountRemaining = Math.max(0, targetAmount - currentAmount);

  // Calculate required monthly contribution to reach goal
  const monthlyReturn = expectedReturn / 12;
  let requiredMonthly = 0;

  if (monthsRemaining > 0 && amountRemaining > 0) {
    // Future value of current amount
    const fvCurrent = currentAmount * Math.pow(1 + monthlyReturn, monthsRemaining);
    const remainingNeeded = targetAmount - fvCurrent;

    if (remainingNeeded > 0 && monthlyReturn > 0) {
      // PMT formula
      requiredMonthly = remainingNeeded * monthlyReturn / 
        (Math.pow(1 + monthlyReturn, monthsRemaining) - 1);
    } else if (remainingNeeded > 0) {
      requiredMonthly = remainingNeeded / monthsRemaining;
    }
  }

  // Project future value with current contribution
  let projectedValue = currentAmount;
  for (let i = 0; i < monthsRemaining; i++) {
    projectedValue = projectedValue * (1 + monthlyReturn) + monthlyContribution;
  }

  // Calculate if on track
  const onTrack = projectedValue >= targetAmount;
  const shortfall = onTrack ? 0 : targetAmount - projectedValue;
  const surplus = onTrack ? projectedValue - targetAmount : 0;

  // Calculate months to goal at current rate
  let monthsToGoal = Infinity;
  if (monthlyContribution > 0 || currentAmount >= targetAmount) {
    let testValue = currentAmount;
    let months = 0;
    while (testValue < targetAmount && months < 600) {
      testValue = testValue * (1 + monthlyReturn) + monthlyContribution;
      months++;
    }
    monthsToGoal = testValue >= targetAmount ? months : Infinity;
  }

  // Inflation-adjusted target
  const inflationAdjustedTarget = targetAmount * 
    Math.pow(1 + inflationRate, monthsRemaining / 12);

  return {
    goalId: goal.id,
    goalName: goal.name,
    currentAmount: currentAmount,
    targetAmount: targetAmount,
    progressPercent: progressPercent,
    amountRemaining: amountRemaining,
    monthlyContribution: monthlyContribution,
    requiredMonthlyContribution: Math.max(0, requiredMonthly),
    contributionGap: Math.max(0, requiredMonthly - monthlyContribution),
    projectedValue: projectedValue,
    onTrack: onTrack,
    shortfall: shortfall,
    surplus: surplus,
    monthsRemaining: monthsRemaining,
    monthsToGoal: monthsToGoal,
    yearsToGoal: monthsToGoal / 12,
    inflationAdjustedTarget: inflationAdjustedTarget,
    deadline: goal.deadline,
    expectedReturn: expectedReturn
  };
}

/**
 * Run Monte Carlo simulation for goal probability
 * @param {Object} goal - Goal object
 * @param {Object} config - Simulation config
 */
function simulateGoalProbability(goal, config) {
  const {
    iterations = 5000,
    expectedReturn = 0.07,
    volatility = 0.15
  } = config || {};

  const currentAmount = goal.currentAmount || 0;
  const targetAmount = goal.targetAmount || 0;
  const monthlyContribution = goal.monthlyContribution || 0;
  const monthsRemaining = Math.floor(goal.monthsRemaining || 120);

  const monthlyReturn = expectedReturn / 12;
  const monthlyVol = volatility / Math.sqrt(12);

  const results = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    let value = currentAmount;

    for (let month = 0; month < monthsRemaining; month++) {
      // Random return using normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const randomReturn = monthlyReturn + monthlyVol * z;

      value = value * (1 + randomReturn) + monthlyContribution;
    }

    results.push(value);
    if (value >= targetAmount) successCount++;
  }

  // Sort results
  results.sort(function(a, b) { return a - b; });

  // Calculate percentiles
  const percentiles = {
    p5: results[Math.floor(iterations * 0.05)],
    p25: results[Math.floor(iterations * 0.25)],
    p50: results[Math.floor(iterations * 0.50)],
    p75: results[Math.floor(iterations * 0.75)],
    p95: results[Math.floor(iterations * 0.95)]
  };

  const probability = (successCount / iterations) * 100;

  return {
    goalId: goal.id,
    goalName: goal.name,
    targetAmount: targetAmount,
    probability: probability,
    percentiles: percentiles,
    medianOutcome: percentiles.p50,
    iterations: iterations,
    expectedReturn: expectedReturn,
    volatility: volatility,
    riskAssessment: assessGoalRisk(probability, percentiles, targetAmount),
    recommendations: generateGoalRecommendations(probability, goal, percentiles)
  };
}

/**
 * Assess risk level for goal
 */
function assessGoalRisk(probability, percentiles, targetAmount) {
  const p5Shortfall = Math.max(0, targetAmount - percentiles.p5);
  const p5ShortfallPercent = (p5Shortfall / targetAmount) * 100;

  let riskLevel;
  let message;

  if (probability >= 90) {
    riskLevel = 'low';
    message = 'High confidence of reaching goal';
  } else if (probability >= 70) {
    riskLevel = 'moderate';
    message = 'Good chance of reaching goal with current plan';
  } else if (probability >= 50) {
    riskLevel = 'elevated';
    message = 'Consider increasing contributions or adjusting target';
  } else {
    riskLevel = 'high';
    message = 'Significant risk of not reaching goal';
  }

  return {
    riskLevel: riskLevel,
    message: message,
    worstCaseShortfall: p5Shortfall,
    worstCaseShortfallPercent: p5ShortfallPercent
  };
}

/**
 * Generate recommendations for goal
 */
function generateGoalRecommendations(probability, goal, percentiles) {
  const recommendations = [];
  const targetAmount = goal.targetAmount || 0;
  const currentContribution = goal.monthlyContribution || 0;

  if (probability < 70) {
    // Calculate required increase
    const shortfall = targetAmount - percentiles.p50;
    const monthsRemaining = goal.monthsRemaining || 120;
    const additionalMonthly = shortfall > 0 ? shortfall / monthsRemaining : 0;

    recommendations.push({
      type: 'increase_contribution',
      priority: 'high',
      message: 'Consider increasing monthly contribution by ' + 
        additionalMonthly.toFixed(0) + ' EUR',
      impact: '+' + Math.round((additionalMonthly / (currentContribution || 1)) * 100) + '% contribution'
    });
  }

  if (probability < 50) {
    recommendations.push({
      type: 'extend_timeline',
      priority: 'medium',
      message: 'Consider extending your goal deadline if possible',
      impact: 'More time for compound growth'
    });

    recommendations.push({
      type: 'adjust_target',
      priority: 'medium',
      message: 'Consider adjusting target to ' + 
        Math.round(percentiles.p50).toLocaleString() + ' EUR (50th percentile)',
      impact: 'More achievable goal'
    });
  }

  if (probability >= 90 && percentiles.p50 > targetAmount * 1.3) {
    recommendations.push({
      type: 'reduce_contribution',
      priority: 'low',
      message: 'You may be over-saving for this goal. Consider redirecting some contributions.',
      impact: 'Optimize across goals'
    });
  }

  const goalType = GOAL_TYPES[goal.type];
  if (goalType && goal.monthsRemaining > 60) {
    recommendations.push({
      type: 'allocation',
      priority: 'info',
      message: 'Suggested allocation: ' + 
        goalType.suggestedAllocation.stocks + '% stocks, ' +
        goalType.suggestedAllocation.bonds + '% bonds, ' +
        goalType.suggestedAllocation.cash + '% cash',
      impact: 'Risk-appropriate investing'
    });
  }

  return recommendations;
}

/**
 * Optimize contributions across multiple goals
 * @param {Array} goals - Array of goal objects
 * @param {number} totalMonthlyBudget - Total available monthly contribution
 */
function optimizeGoalContributions(goals, totalMonthlyBudget) {
  if (!goals || goals.length === 0) {
    return { error: 'No goals to optimize' };
  }

  // Calculate priority scores for each goal
  const scoredGoals = goals.map(function(goal) {
    const progress = calculateGoalProgress(goal);
    
    // Priority weights
    const priorityWeight = {
      high: 3,
      medium: 2,
      low: 1
    }[goal.priority] || 2;

    // Urgency based on deadline
    const urgencyScore = goal.monthsRemaining < 24 ? 3 :
      goal.monthsRemaining < 60 ? 2 : 1;

    // Gap score (how far behind)
    const gapScore = progress.onTrack ? 1 : 
      (progress.shortfall / goal.targetAmount) * 5;

    const totalScore = priorityWeight * urgencyScore * (1 + gapScore);

    return {
      goal: goal,
      progress: progress,
      priorityWeight: priorityWeight,
      urgencyScore: urgencyScore,
      gapScore: gapScore,
      totalScore: totalScore
    };
  });

  // Sort by score (highest priority first)
  scoredGoals.sort(function(a, b) {
    return b.totalScore - a.totalScore;
  });

  // Allocate budget
  const totalScore = scoredGoals.reduce(function(sum, g) {
    return sum + g.totalScore;
  }, 0);

  let remainingBudget = totalMonthlyBudget;
  const allocations = [];

  scoredGoals.forEach(function(scored) {
    // Proportional allocation based on score
    let allocation = (scored.totalScore / totalScore) * totalMonthlyBudget;
    
    // Cap at required amount if goal is close to target
    const maxNeeded = scored.progress.requiredMonthlyContribution;
    if (maxNeeded > 0 && allocation > maxNeeded * 1.2) {
      allocation = maxNeeded * 1.2;
    }

    allocation = Math.min(allocation, remainingBudget);
    remainingBudget -= allocation;

    allocations.push({
      goalId: scored.goal.id,
      goalName: scored.goal.name,
      currentContribution: scored.goal.monthlyContribution,
      suggestedContribution: allocation,
      change: allocation - (scored.goal.monthlyContribution || 0),
      priority: scored.goal.priority,
      urgency: scored.urgencyScore > 2 ? 'high' : scored.urgencyScore > 1 ? 'medium' : 'low',
      onTrack: scored.progress.onTrack,
      score: scored.totalScore
    });
  });

  return {
    totalBudget: totalMonthlyBudget,
    allocations: allocations,
    unallocated: remainingBudget,
    summary: {
      goalsOnTrack: allocations.filter(function(a) { return a.onTrack; }).length,
      goalsNeedingMore: allocations.filter(function(a) { return !a.onTrack; }).length,
      totalAllocated: totalMonthlyBudget - remainingBudget
    }
  };
}

/**
 * Calculate all goals summary
 */
function calculateGoalsSummary(goals, config) {
  const summaries = goals.map(function(goal) {
    return calculateGoalProgress(goal, config);
  });

  const totalTargetAmount = summaries.reduce(function(sum, s) {
    return sum + s.targetAmount;
  }, 0);

  const totalCurrentAmount = summaries.reduce(function(sum, s) {
    return sum + s.currentAmount;
  }, 0);

  const totalMonthlyContribution = summaries.reduce(function(sum, s) {
    return sum + s.monthlyContribution;
  }, 0);

  const totalRequiredContribution = summaries.reduce(function(sum, s) {
    return sum + s.requiredMonthlyContribution;
  }, 0);

  const goalsOnTrack = summaries.filter(function(s) { return s.onTrack; }).length;

  return {
    totalGoals: goals.length,
    goalsOnTrack: goalsOnTrack,
    goalsOffTrack: goals.length - goalsOnTrack,
    totalTargetAmount: totalTargetAmount,
    totalCurrentAmount: totalCurrentAmount,
    overallProgress: totalTargetAmount > 0 ? 
      (totalCurrentAmount / totalTargetAmount) * 100 : 0,
    totalMonthlyContribution: totalMonthlyContribution,
    totalRequiredContribution: totalRequiredContribution,
    contributionGap: Math.max(0, totalRequiredContribution - totalMonthlyContribution),
    goalDetails: summaries
  };
}

/**
 * Project goal timeline with milestones
 */
function projectGoalTimeline(goal, config) {
  const {
    expectedReturn = 0.07,
    milestonePercentages = [25, 50, 75, 90, 100]
  } = config || {};

  const currentAmount = goal.currentAmount || 0;
  const targetAmount = goal.targetAmount || 0;
  const monthlyContribution = goal.monthlyContribution || 0;
  const monthlyReturn = expectedReturn / 12;

  const milestones = [];
  const timeline = [];

  let value = currentAmount;
  let month = 0;
  const maxMonths = 600;

  while (value < targetAmount && month < maxMonths) {
    value = value * (1 + monthlyReturn) + monthlyContribution;
    month++;

    // Check for milestones
    const progress = (value / targetAmount) * 100;
    
    milestonePercentages.forEach(function(pct) {
      const existingMilestone = milestones.find(function(m) { return m.percentage === pct; });
      if (!existingMilestone && progress >= pct) {
        milestones.push({
          percentage: pct,
          month: month,
          date: addMonths(new Date(), month),
          value: value
        });
      }
    });

    // Record timeline point every 3 months
    if (month % 3 === 0 || month === 1) {
      timeline.push({
        month: month,
        date: addMonths(new Date(), month),
        value: value,
        progress: progress
      });
    }
  }

  return {
    goalId: goal.id,
    goalName: goal.name,
    currentAmount: currentAmount,
    targetAmount: targetAmount,
    monthsToCompletion: month < maxMonths ? month : null,
    completionDate: month < maxMonths ? addMonths(new Date(), month) : null,
    milestones: milestones,
    timeline: timeline,
    achievable: month < maxMonths
  };
}

/**
 * Helper: Add months to date
 */
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Compare different scenarios for reaching a goal
 */
function compareGoalScenarios(goal, scenarios) {
  const results = [];

  scenarios.forEach(function(scenario) {
    const modifiedGoal = Object.assign({}, goal, {
      monthlyContribution: scenario.monthlyContribution || goal.monthlyContribution
    });

    const progress = calculateGoalProgress(modifiedGoal, {
      expectedReturn: scenario.expectedReturn || 0.07
    });

    const simulation = simulateGoalProbability(modifiedGoal, {
      expectedReturn: scenario.expectedReturn || 0.07,
      volatility: scenario.volatility || 0.15,
      iterations: 2000
    });

    results.push({
      scenarioName: scenario.name,
      monthlyContribution: modifiedGoal.monthlyContribution,
      expectedReturn: scenario.expectedReturn || 0.07,
      projectedValue: progress.projectedValue,
      probability: simulation.probability,
      medianOutcome: simulation.medianOutcome,
      monthsToGoal: progress.monthsToGoal
    });
  });

  // Sort by probability
  results.sort(function(a, b) {
    return b.probability - a.probability;
  });

  return {
    goalName: goal.name,
    targetAmount: goal.targetAmount,
    scenarios: results,
    recommendation: results[0] ? 
      'Best scenario: ' + results[0].scenarioName + ' with ' + 
      results[0].probability.toFixed(0) + '% probability' : null
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.GoalInvestingEngine = {
    GOAL_TYPES: GOAL_TYPES,
    createGoal: createGoal,
    calculateGoalProgress: calculateGoalProgress,
    simulateGoalProbability: simulateGoalProbability,
    optimizeGoalContributions: optimizeGoalContributions,
    calculateGoalsSummary: calculateGoalsSummary,
    projectGoalTimeline: projectGoalTimeline,
    compareGoalScenarios: compareGoalScenarios
  };
  
  console.log('[OK] Goal-Based Investing Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GOAL_TYPES,
    createGoal,
    calculateGoalProgress,
    simulateGoalProbability,
    optimizeGoalContributions,
    calculateGoalsSummary,
    projectGoalTimeline,
    compareGoalScenarios
  };
}
