# Prompts that cross between sessions

Read by whatever produces a prompt that crosses into another session. It owns the
envelope — what holds for any such prompt, whichever direction it travels. What
fills the slots belongs to the skill that produces the prompt.

## Three carriers, one envelope

A prompt crosses as a paste block the user carries by hand, as the starting prompt
of a chip-spawned session, or as a message sent between live sessions. Everything
here holds for all three: **the text is the whole channel, and what is not written
in it does not arrive.** Which carrier moves a given prompt is chosen where the
prompt is produced.

## The envelope

- **The reader is elsewhere.** It has no access to this session, so nothing points
  back here — no "as discussed above", no reference to earlier output, and never an
  absolute or checkout-specific path. A repo-relative path is the portable form and
  is what a coordinate is written in; name a repository only where the reader could
  be in a different one.
- **It is a task, not a document.** Second person, imperative, ending in something
  to do.
- **Point, don't retell.** Anything the reader can read for itself — a diff, a
  file, an issue — is named rather than narrated. What it cannot read anywhere is
  stated in full: a fact established by reading, a conclusion written down nowhere,
  a decision already taken.
- **Every assertion carries where to re-check it** — a file and line, an issue, a
  command. An item recall is unsure of stays in, marked unsure, never dropped.
- **The first line states the origin**: where the text came from, what it is, and
  the tag where one exists. Beside the tag, the subject in one line of prose, so a
  tag the reader cannot match still reads as an ordinary prompt rather than a dead
  reference.
- **Say what not to do**: what would duplicate or undo work, what another track
  holds, what is not the reader's to touch.
- **The closing act is never empty.** Every crossing prompt ends in something that
  terminates — an answer to return, a deliverable to produce, or an end state to
  reach. It is the last numbered step and it is never optional.

## Delivery

Write the prompt in the language this session is conducted in, leaving identifiers,
paths and commands as they are. A slot with nothing in it says so in a word rather
than being dropped — a missing line reads as an omission.

A pasteable prompt is emitted whole, inside a fenced block of plain text, never
paraphrased into prose around it. What is addressed to this session instead of to
the reader — what it now waits on, what it offers to do next — goes after the
closing fence, and may name the prompt's tag. A chip carries the same text as the
new session's first prompt; a message carries it as the message body, its first
line self-contained because the recipient's human previews only that line.

A pasteable prompt's fence is three backticks; where the text inside carries a run
of three or more, use one backtick more than the longest run.
