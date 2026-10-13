# events: parser, validator, aggregator

Goal: a log-line pipeline. Three parts share the `Event` types in `events.ts`. The parser turns a
line into an event or a rejection, the validator accepts or rejects an event, and the aggregator
runs both over a list of lines and summarises what passed.
