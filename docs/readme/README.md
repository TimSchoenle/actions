# Writing a README

How every repository here documents itself: one contract for what a README contains, one for how its
prose is written, and a template to start from.

The idea underneath all of it is that a README states facts that already exist somewhere else — a
version, a licence, a configuration key, a list of documents — and those facts should be read from
where they live rather than typed a second time. What is typed twice goes stale. The
[readme-variables](../../actions/common/readme-variables) action reads them, and
[render-template](../../actions/common/render-template) interpolates them into a template that a CI
job re-renders and compares on every push.

## What is here

| File | Read it when |
| --- | --- |
| [GUIDE.md](./GUIDE.md) | Writing or restructuring a README. The section order, the rules, the CI wiring, and the traps that cost us a day each. |
| [PROSE.md](./PROSE.md) | Writing any prose at all — README, template, `docs/` page, commit body, pull request. |
| [TEMPLATE.md.hbs](./TEMPLATE.md.hbs) | Starting a new one. Copy it to `.github/templates/README.md.hbs` and work through the markers. |
| [EXAMPLE.md](./EXAMPLE.md) | You want to see the target rather than read about it. A finished README for a real repository. |

## The short version

1. Copy [TEMPLATE.md.hbs](./TEMPLATE.md.hbs) to `.github/templates/README.md.hbs`.
2. Wire the two-job workflow from [GUIDE.md](./GUIDE.md#the-workflow). One job renders and commits on
   pull requests; the other renders with `check: 'true'` and fails when the committed file is stale.
3. Write the prose against [PROSE.md](./PROSE.md).
4. Make the drift job a required check. Without that, the template is a suggestion.

## What this is not

It is not a style guide for the sake of one. Two of its rules exist because they broke something:
the em dash budget came from a README where every second sentence used one as a full stop, and the
"assign before you echo" rule in the guide came from a workflow that reported success while its
generator failed. Everything else earns its place the same way or is not in here.
