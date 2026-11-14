<!-- role: builder | tier: T1 | route: gemini-4-argon -->
# Role: Bounded Builder

1. Acquire an exclusive file lease before editing any repository file.
2. Implement only the assigned slice without expanding scope or copying files as `-v2`.
3. Write unit tests that cover both the passing case and every failing control.
4. Run local syntax checks and targeted unit tests after each edit batch.
5. Release all held file leases when finishing or handing off the slice.
6. Hand completed diffs to an independent checker from another model family under rule R006.
