import { describe, expect, it } from 'vitest';
import { cleanDisplayText, cleanEmailForDisplay } from '../renderer/emailReader';

const linkedInJobAlert = `
6/3/2026 ͏ ͏ ͏

Your job alert for software engineer in 500025
New jobs match your preferences.
Manage alerts: https://www.linkedin.com/comm/jobs/alerts?tracking=long

Gen AI Engineer
Qloron Pvt Ltd
Hyderabad

This company is actively hiring
View job: https://www.linkedin.com/comm/jobs/view/4424003583/?trackingId=abc&midToken=secret

---------------------------------------------------------

<strong class="font-bold" style="font-weight: 600;">software engineer</strong> jobs in India

Agentic AI Developer (Remote / Hybrid)
Dusker AI
India
View job: https://www.linkedin.com/comm/jobs/view/4417540719/?trackingId=def

This email was intended for Sai Kiran Myadaram
You are receiving Job Alert emails.
Unsubscribe: https://www.linkedin.com/job-alert-email-batch-unsubscribe?token=secret
© 2026 LinkedIn Corporation
`;

const xingJobAlert = `
View message in browser https://www.xing.com/mail/browser/abc?tracking=long

XING

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Hi Sai Kiran,
Check out what our AI-enhanced search found for you

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Be an early applicant
Duales Studium Informatik (B.Sc.) am Campus oder virtuell

=>

=>
IU Internationale Hochschule GmbH
Berlin

Full-time

Show all search results:
https://www.xing.com/jobs/search?tracking=long

=>

Tell us what you think
Did you find this e-mail useful?
No
xing.com
Somewhat
xing.com
`;

describe('cleanEmailForDisplay', () => {
  it('removes invisible characters and HTML fragments', () => {
    expect(cleanDisplayText('6/3/2026 ͏ <strong class="font-bold">software engineer</strong>')).toBe(
      '6/3/2026 software engineer',
    );
  });

  it('collapses long links while preserving readable job content', () => {
    const cleaned = cleanEmailForDisplay(linkedInJobAlert);
    const visibleText = JSON.stringify(cleaned.visible);

    expect(visibleText).toContain('Gen AI Engineer');
    expect(visibleText).toContain('Qloron Pvt Ltd');
    expect(visibleText).toContain('software engineer jobs in India');
    expect(cleaned.linksCollapsed).toBeGreaterThanOrEqual(2);
    expect(visibleText).not.toContain('trackingId=abc');
  });

  it('hides footer and subscription content by default', () => {
    const cleaned = cleanEmailForDisplay(linkedInJobAlert);
    const visibleText = JSON.stringify(cleaned.visible);
    const hiddenText = JSON.stringify(cleaned.hiddenFooter);

    expect(visibleText).not.toContain('Unsubscribe');
    expect(visibleText).not.toContain('LinkedIn Corporation');
    expect(hiddenText).toContain('Unsubscribe');
    expect(cleaned.hiddenLineCount).toBeGreaterThan(0);
    expect(cleaned.rawText).toContain('trackingId=abc');
  });

  it('cleans XING job alerts without duplicate link labels or arrow markers', () => {
    const cleaned = cleanEmailForDisplay(xingJobAlert);
    const visibleText = JSON.stringify(cleaned.visible);
    const hiddenText = JSON.stringify(cleaned.hiddenFooter);

    expect(visibleText).toContain('View message in browser');
    expect(visibleText.match(/View message in browser/g)).toHaveLength(1);
    expect(visibleText).toContain('Duales Studium Informatik');
    expect(visibleText).toContain('IU Internationale Hochschule GmbH');
    expect(visibleText).not.toContain('=>');
    expect(visibleText).not.toContain('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    expect(visibleText).not.toContain('Tell us what you think');
    expect(hiddenText).toContain('Tell us what you think');
  });
});
