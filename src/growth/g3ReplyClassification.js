const normalize = (value) => String(value ?? '').trim().toLowerCase();

const includesAny = (text, phrases) => phrases.some((phrase) => text.includes(phrase));

const RULES = [
  {
    classification: 'opt_out',
    phrases: ['unsubscribe', 'remove me', 'stop emailing', 'stop email', 'do not contact', "don't contact", 'no more emails', 'take me off'],
  },
  {
    classification: 'wrong_contact',
    phrases: ['wrong person', 'wrong contact', 'not the person', 'no longer works here', 'does not work here', "doesn't work here"],
  },
  {
    classification: 'not_interested',
    phrases: ['not interested', 'no thanks', 'no thank you', 'not looking', 'we are good', "we're good"],
  },
  {
    classification: 'referral',
    phrases: ['contact ', 'reach out to ', 'speak with ', 'talk to ', 'you should email ', 'you should call '],
  },
  {
    classification: 'timing_later',
    phrases: ['later', 'next month', 'next quarter', 'not right now', 'circle back', 'follow up later', 'check back'],
  },
  {
    classification: 'request_information',
    phrases: ['send more information', 'more information', 'more info', 'pricing', 'price', 'rates', 'quote', 'proposal', 'services', 'what do you offer'],
  },
  {
    classification: 'positive_interest',
    phrases: ['interested', 'sounds good', 'let us talk', "let's talk", 'schedule a call', 'book a call', 'set up a call', 'can we talk', 'yes please'],
  },
];

export function classifyGrowthReply(input) {
  const text = normalize(input?.text);
  if (!text) {
    return {
      classification: 'unclear',
      confidence: 'low',
      sequenceAction: 'stop',
      qualificationState: 'qualification_pending',
      requiresHumanReview: true,
      reasons: ['empty_or_missing_reply_text'],
    };
  }

  for (const rule of RULES) {
    if (includesAny(text, rule.phrases)) {
      const suppressed = rule.classification === 'opt_out';
      return {
        classification: rule.classification,
        confidence: 'rule_match',
        sequenceAction: 'stop',
        qualificationState: suppressed ? 'suppressed' : 'qualification_pending',
        requiresHumanReview: !suppressed,
        reasons: [`matched_${rule.classification}`],
      };
    }
  }

  return {
    classification: 'unclear',
    confidence: 'low',
    sequenceAction: 'stop',
    qualificationState: 'qualification_pending',
    requiresHumanReview: true,
    reasons: ['no_deterministic_rule_match'],
  };
}

export function evaluateGrowthQualification(input) {
  const classification = input?.classification;
  const humanQualified = input?.humanQualified === true;
  const verifiedServiceNeed = input?.verifiedServiceNeed === true;
  const supportedGeography = input?.supportedGeography === true;
  const verifiedReachableContact = input?.verifiedReachableContact === true;
  const activeSuppression = input?.activeSuppression === true;

  if (activeSuppression || classification === 'opt_out') {
    return { state: 'suppressed', handoffEligible: false, reasons: ['suppression_control'] };
  }

  if (classification === 'not_interested' || classification === 'wrong_contact') {
    return { state: 'disqualified', handoffEligible: false, reasons: [`classification_${classification}`] };
  }

  if (classification === 'timing_later') {
    return { state: 'nurture', handoffEligible: false, reasons: ['timing_later'] };
  }

  const missing = [];
  if (!humanQualified) missing.push('human_qualification_required');
  if (!verifiedServiceNeed) missing.push('verified_service_need_required');
  if (!supportedGeography) missing.push('supported_geography_required');
  if (!verifiedReachableContact) missing.push('verified_reachable_contact_required');

  if (missing.length > 0) {
    return { state: 'qualification_pending', handoffEligible: false, reasons: missing };
  }

  if (!['positive_interest', 'request_information', 'referral'].includes(classification)) {
    return { state: 'qualification_pending', handoffEligible: false, reasons: ['qualifying_reply_classification_required'] };
  }

  return {
    state: 'handoff_candidate',
    handoffEligible: false,
    reasons: ['g3_handoff_candidate_requires_separate_g4_handoff'],
  };
}
