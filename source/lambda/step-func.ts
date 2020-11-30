import * as AWS from "aws-sdk";


/**
 * This lambda should be triggered when stack is created or updated.
 * The purpose is to ensure replication task is started immediately (step functions is triggered) on create or update
 * Ideally, the step functions should be triggered by event bridge rule, but this doesn't work all the time.
 * This is a workaround to resolve the issue.
 *
 * @param event:any - Not used.
 */

exports.handler = async (event: any) => {
    const stateMachineArn: string = process.env.STATE_MACHINE_ARN ? process.env.STATE_MACHINE_ARN : 'null'

    const sfn = new AWS.StepFunctions();

    var queryParams = {
        stateMachineArn: stateMachineArn,
        statusFilter: 'RUNNING'
    };

    var execParams = {
        stateMachineArn: stateMachineArn,
    };

    // Check if any running executions
    const list = await sfn.listExecutions(queryParams).promise();
    console.log(list.executions);

    if (list.executions.length == 0) {
        //if not, start a new one
        const executionArn = await sfn.startExecution(execParams).promise();
        console.log(executionArn);
    }


}