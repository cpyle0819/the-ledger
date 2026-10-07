Good work needs room to be understood. A description should explain what we are trying to change, who benefits, and how we will know the work is complete. It should be readable before anyone has to decode a status field or a planning estimate.

This shipment gives readers a quieter place to start. The proposal remains connected to its owner, discussion, and delivery plan, but the narrative leads. Those details support the decision; they do not interrupt every paragraph.

## Start with the reader

A task can be small without being obvious. Someone returning to a piece of work after a week needs enough context to pick up the thread. Someone reviewing it for the first time needs to understand its purpose without opening three other systems.

We keep the useful questions close to the writing: What problem does this solve? What does success look like? What remains uncertain? A clear description makes those answers easy to find and leaves space for evidence, examples, and tradeoffs.

> The reader should spend their attention on the idea, not on finding the next line.

## A considered shipment

The work proceeds through a few concrete steps:

1. Agree on the behavior that readers need.
2. Build the smallest complete version of that behavior.
3. Check the result with realistic content and ordinary reading conditions.
4. Record the decisions that the next person will need.

A useful implementation supports all of the content we already write:

- Short summaries and longer explanations.
- Links to evidence and related work.
- Code samples that retain their spacing.
- Tables whose columns remain understandable on a narrow screen.

### Keep the supporting detail

The owner, workflow, estimates, and dates remain part of the item. They belong with its planning details, where a reader can find or edit them when needed. A full-screen article is still the same work item, with the same permissions and the same discussion.

### A small technical example

The following sample illustrates a stable request shape. Long lines scroll within the code block, leaving the prose at its readable width.

```json
{"shipment":"reading-view","checks":["saved defaults","draft preservation","keyboard navigation","narrow screens"],"description":"A deliberately long code line that must never widen the article or hide the close control."}
```

| Surface | Reading behavior | Supporting detail |
| --- | --- | --- |
| Description | Leads the page | Full Markdown content |
| Planning | Opens on request | Estimates, dates, and children |
| Discussion | Follows the article | Existing comments and composer |

## What completion means

The shipment is ready when a reader can open an item, read its description comfortably, inspect the supporting details, and return to the board without losing their place. Changing the panel width must preserve an unfinished description. A saved preference should still apply after a reload or a change of theme.

The long reference identifier below exercises wrapping without introducing an external request:

`reading-view-verification-abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789`

The final check is ordinary reading. Does the title make a promise that the description fulfills? Can the reader find the important evidence? Are the controls available without competing with the text? The answer should be visible in the page itself.
