# How it works

Status: Works today. The Google Vertex route and the local gateway are a separate small program, outside this repository.

## One request

In this setup, gateway providers and memory go through one local gateway. It adds your keys, refuses writes without its token, and reaches the outside services. A provider with its own key on the Models page connects directly.

![The app sends a request to the local gateway, which reaches the model services, Google Vertex and Cammut](images/request-flow.png)

## One task

The agent proposes, the work is frozen, and another reviewer gates it. Each step goes into a hash-chained ledger, and the Trace tab reads it. No agent accepts its own work.

![Harness of Harness: propose, freeze, accept gate and ledger](images/hoh-cycle.png)

## One build

The kit turns your copy of the original app into Arc Harness. The build stops if a patch does not find its text.

![The build kit: build, build check and install](images/arc-build.png)

## What it looks like

![Home screen in the light look](images/light-home.png)

![A session in the dark look](images/dark-session.png)

![The Models page in Settings](images/light-settings-models.png)
