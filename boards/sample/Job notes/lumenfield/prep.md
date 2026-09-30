---
asks: Design and own idempotent payment APIs | Bring p99 latency down and keep it there | Mentor two mid-level engineers
---
# Lumenfield Software: Senior Software Engineer, Payments API

## Your opener

1. Backend engineer who owns services end to end, from design doc to pager.
2. Rebuilt the checkout API: p99 latency from 900 ms to 250 ms.
3. Led the move from a shared database to per-service schemas for six services.
4. Want to work closer to payments, on a team that treats reliability as a feature.
5. Ask what a great first six months looks like to them.

> I'm a backend engineer who likes owning a service end to end. Most recently I rebuilt our checkout API and cut its p99 latency from 900 to 250 milliseconds. Lumenfield's payments work looks like the next step for me.

## Why Lumenfield

- Their engineering blog describes payments as a product with its own roadmap: that's the work you want.
- Small teams that own their services, including on-call.
- ☐ Find out whether the team uses Go or Java for new services (the posting lists both).

## Likely questions

### Walk me through a system you designed.

> The checkout API: a stateless Go service in front of Postgres, with an idempotency key on every write so retries never charge twice. I wrote the design doc, got two rounds of review, and we shipped it in six weeks.

### How do you make a payment API safe to retry? ✎

> Every request carries an idempotency key. The first call stores the key with the result in the same transaction; a retry with the same key returns the stored result instead of running again.

- *<Keys expire after 24 hours; clients get a clear error if they reuse a key with a different body.>*
- *<Mention the outbox pattern for events that must not be lost.>*

### How do you handle on-call?

> I treat alerts like bugs: every page gets a short write-up and a fix for the cause, not just the symptom. On my team we cut pages by half in two quarters by fixing the top three causes each month.

### Tell me about a code review disagreement.

> A teammate wanted to add a cache in front of a slow query. I suggested fixing the query first; we agreed to measure both. The index fix got us most of the way, so we skipped the cache and avoided a new failure mode.

## Gaps they may probe

- **No Java in production.** Bridge: you've written Go and Kotlin; the concurrency and testing habits carry over, and you've read their open-source Java client.
- **Never led a whole team.** Bridge: you've led projects across three engineers and mentor two juniors today.

## Don't say

- Complaints about past managers or teammates.
- A pay number before they share the range.

## Pay {.pay}

- Posted range: in the posting.
- Your target and your floor: ☐ decide before the call (see the cheat sheet).

## Questions to ask them

1. Which parts of the payment flow does the team own today, and which belong to other teams?
2. How do you decide what goes on the roadmap versus the reliability backlog?
3. What would make this hire a clear success after a year?

## What you sent them

- Résumé v3 (backend version) and a cover letter that leads with the checkout API story.
- Referral from Hana Sato on the careers site.
