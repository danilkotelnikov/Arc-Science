# The working loop

The working loop is how we run agents on real work. Rules go in, evidence comes out, and lessons return to the next prompt. The app ships the gate and the ledger. The rest is a set of small hooks and files that you can copy for your own agents.

## One prompt

1. A person sends a prompt. A hook gives it a tag and splits it into numbered tasks.
2. Hooks add the rules for the turn: how to talk, what to check and which lessons fit the words of the prompt.
3. The agent reads the code it will touch and recalls earlier facts only when the task needs them.
4. The agent builds the smallest piece that passes a check it wrote first.
5. Each write passes small checks: word rules, private data and figure checks.
6. A fresh reviewer checks the frozen work. The builder never accepts its own work.
7. At the end of the turn, a hook checks that each task has an outcome: done, rejected, blocked or open.
8. A task with no outcome moves to the next prompt.
9. The memory system saves the new facts. A failed step or a correction becomes a lesson with an area tag.
10. The next prompt in that area shows the lesson.

## One policy

We keep one policy file. A sync tool installs it into each agent, so every agent reads the same rules. A person changes the file, and the agents never change it.

## Gates

A gate is a check with a recorded verdict. Each check writes one row: what was checked, the result and who ran it. The person who owns the work can add a verdict to the row. A rejected row shows a check that passed and still missed the point, and then we build a new check.

## Focus

Each plan step names its task. A task with no outcome and a step with no task each add one point. At three points the hook refuses new agents and sessions until the open tasks have outcomes.

## Memory

We recall only what the task needs, and we retain only outcomes: a decision, a correction, a finished piece of work or a verified fact. Each note holds one fact. We read a note back before we say that it was saved. To correct a note, we retire it and save the right fact. A file on disk and the owner's latest message win over a note.

## Daily reconcile

Once a day a script compares the policy, hooks, memory code, road map and gate counts with the day before. The first prompt of the day shows what changed and which agent is behind. A quiet day shows nothing. The script reads local files only, and it never writes to memory.

## Where the loop is weak

- Lesson candidates pile up in an inbox, and nothing moves them into memory on its own.
- A hook matches the word for an outcome. It does not prove the work.
- Only agents with hooks get the prompt checks. Other agents read the policy alone.
- The daily brief reaches one agent today. A brief for every agent has to come from the memory server.
