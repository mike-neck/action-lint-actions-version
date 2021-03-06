import {Action, Workflow} from "./workflow";
import {Either, left, right} from "./either";
import {Inputs} from "./inputs";
import {Both, bothBuilder} from "./both";
import {Inspection, inspection, JobInspection} from "./types";
import * as github from "@actions/github";

import {RestEndpointMethods} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types";
import {OctokitResponse} from "@octokit/types/dist-types/OctokitResponse"
import {ReposListTagsResponseData} from "@octokit/types/dist-types/generated/Endpoints"

export interface ListTagsApi {
    call(owner: string, repo: string): Promise<Either<number, string>>
}

export function listTagApi(inputs: Inputs): ListTagsApi {
    const octokit = github.getOctokit(inputs.token) as RestEndpointMethods;
    return {
        call(owner: string, repo: string): Promise<Either<number, string>> {
            const f = async () => {
                console.debug(`owner: ${owner}, repo: ${repo}`);
                const response: OctokitResponse<ReposListTagsResponseData> = await octokit.repos.listTags({
                    owner: owner,
                    repo: repo
                });
                if (response.status < 200 || 300 <= response.status) {
                    return Promise.resolve(left<number, string>(response.status));
                }
                const data: ReposListTagsResponseData = response.data;
                if (data.length == 0) {
                    return Promise.resolve(right<number, string>(""));
                }
                const tag = data.sort((l, r) => r.name.localeCompare(l.name) )[0].name;
                return Promise.resolve(right<number, string>(tag));
            };
            return f();
        }
    }
}

async function apiCall(api: ListTagsApi, owner: string, repo: string): Promise<Either<number, string>> {
    return api.call(owner, repo)
}

export module InspectionTestOnly {
    export async function inspectWorkflowForTest(api: ListTagsApi, inputs: Inputs, workflow: Workflow): Promise<Both<string, JobInspection>> {
        return inspectWorkflow(api, inputs, workflow)
    }
}

export async function inspectWorkflow(api: ListTagsApi, inputs: Inputs, workflow: Workflow): Promise<Both<string, JobInspection>> {
    const builder = bothBuilder<string, JobInspection>();
    for (let [jobName, steps] of workflow.jobs) {
        const inspections = new Array<Inspection>();
        for (let step of steps) {
            const action: Action = step.uses;
            if (action.apiUnavailableReason !== null) {
                builder.left(`skipping job: ${jobName}, step:${step.name}, action: ${action.action}, because ${action.apiUnavailableReason}`);
                continue;
            }
            const either = await apiCall(api, action.owner, action.action);
            const result: Either<string, Inspection> = either.map(tag => {
                return inspection(action.action, action.owner, step.name, tag, action.version);
            }).mapLeft(status =>
                `error job: ${jobName}, step: ${step.name}, action: ${step.uses.owner}/${step.uses.action}, because http error status: ${status}`);
            result.whenLeft(message => builder.left(message))
                .whenRight(result => inspections.push(result));
        }
        builder.right({job: jobName, steps: inspections});
    }
    return builder.build();
}
