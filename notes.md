architecture
*******************
creating scenarios on a 2D plane: objects, positions, objectives, communication.
working pseudocode, not executable code.

enumerated integers / flags
*******************
enum Status:int { ACTIVE=0, WAITING=1, FAILED=2, COMPLETE=3 }
enum Objective:int { REACH_TARGET=0, TRANSFER=1 }
enum Approach:int { BASELINE=0, REDUNDANT=1, ADAPTIVE_LOCAL=2 }
flags Rule:int { NONE=0, REQUIRE_ACK=1, ALLOW_BACKUP=2, ALLOW_LOCAL=4 }
# Enums: choose one value. Flags: combine with bitwise OR, test with AND.
# Core safety constraints stay fixed; flags select optional mechanisms.

class object(){
    def _init_(self,
        name:str,
        position:tuple[float,float],
        target:tuple[float,float],
        objective:Objective,
        status:Status,
        communication:list[communication],
        communication_with:list[str],       # known neighbours, not reachability
        rules:Rule)
}

class communication(){                     # directed connection: source -> destination
    def _init_(self,
        source:str,
        destination:str,
        reliability:float,                 # delivery probability: 0.0 to 1.0
        latency_ticks:int,                 # >= 0
        interrupted:bool)
}

distance(a:object, b:object) -> float:
    return sqrt((b.position.x-a.position.x)^2 + (b.position.y-a.position.y)^2)

# Radio: distance(a,b) <= range_limit:float; infrastructure: configured links.
# Delivery also depends on interruption, reliability and latency.

main.x
*******************
seeds:list[int]                            # reproducible random conditions
rule_sets:list[Rule]                       # selected valid flag combinations
approaches:list[Approach]
steps:int                                 # duration in simulation ticks

# More variables = more possible scenarios, not necessarily more randomness.
# n independent binary switches give 2^n assignments, not all possible outcomes.
# Seed generates conditions; rule bits enable mechanisms. Keep them separate.

for rules:Rule in rule_sets:
    for seed:int in seeds:
        scenario:Scenario = generate(seed, rules)
        # Scenario: positions, objectives, links, timed failures.
        # Sample bounded reliability, delay, demand and outage timing.
        for approach:Approach in approaches:
            world:World = fresh_copy(scenario)
            for tick:int in range(steps):
                apply_failures_and_deliver_messages(world, tick)
                actions:list[Action] = decide_from_local_observations(world, approach)
                apply_actions_together(world, actions)
                check_fixed_safety_constraints(world)
            result:Result = measure(world)
            save(seed, rules, scenario, approach, result)

class Result(){
    completed:int
    violations:int
    mean_delay_ticks:float
    recovery_ticks:int|null                # null = not recovered within run
}

# Semi-brute-force: enumerate selected configurations; sample other values.
# Same initial conditions + external failures for every approach.
# Separate policy randomness; key delivery draws by link/tick/message identity
# so extra messages do not shift every subsequent random event.
# Baseline waits; redundant adds backup; adaptive continues independent actions.
# Explicit cases: healthy, isolated, one-way, primary + backup failure together.
# Save/replay failures, sample nearby parameters, compare across seeds.
# Scenario / World / Action are placeholders for later detail, not implementations.
# Simplified local model: sampled success does not prove safety.
