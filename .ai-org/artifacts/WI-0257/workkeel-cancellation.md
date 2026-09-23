# Cancel the Workkeel planning attempt; retain unrelated historical artifacts

The current CLI allocated WI-0257 because no canonical Work Item used that ID,
but historical compact-evidence artifacts already occupied its artifact folder.
The new design accidentally replaced the historical design in the working tree;
this was detected before any product implementation or commit. The historical
file has been restored byte-for-byte from HEAD. The attempted new design is
retained separately as workkeel-design-attempt.md. No old history was deleted.

The three planning gate references now resolve to the restored historical design
and cannot establish this Workkeel scope. Cancel this attempt rather than present
those gates as valid. A replacement Work Item will use a collision-checked,
Workkeel-specific design filename from creation, preserving all old artifacts.
