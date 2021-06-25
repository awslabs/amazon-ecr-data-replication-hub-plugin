import * as cdk from '@aws-cdk/core';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cr from '@aws-cdk/custom-resources';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ssm from '@aws-cdk/aws-ssm';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as sns from '@aws-cdk/aws-sns';
import * as subscriptions from '@aws-cdk/aws-sns-subscriptions';
import { Rule, Schedule } from '@aws-cdk/aws-events';
import { SfnStateMachine } from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as logs from '@aws-cdk/aws-logs';
import * as kms from '@aws-cdk/aws-kms';
import * as path from 'path';

const { VERSION } = process.env;

/**
 * cfn-nag suppression rule interface
 */
interface CfnNagSuppressRule {
  readonly id: string;
  readonly reason: string;
}


export function addCfnNagSuppressRules(resource: cdk.CfnResource, rules: CfnNagSuppressRule[]) {
  resource.addMetadata('cfn_nag', {
    rules_to_suppress: rules
  });
}


export class DataTransferECRStack extends cdk.Stack {
  private paramGroups: any[] = [];
  private paramLabels: any = {};

  private addToParamGroups(label: string, ...param: string[]) {
    this.paramGroups.push({
      Label: { default: label },
      Parameters: param

    });
  };

  private addToParamLabels(label: string, param: string) {
    this.paramLabels[param] = {
      default: label
    }
  }


  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const sourceType = new cdk.CfnParameter(this, 'sourceType', {
      description: 'Choose type of source container registry, for example Amazon_ECR, or Public from Docker Hub, gco.io, etc.',
      type: 'String',
      default: 'Amazon_ECR',
      allowedValues: ['Amazon_ECR', 'Public']
    })
    this.addToParamLabels('Source Type', sourceType.logicalId)

    // Only required for ECR
    const srcRegion = new cdk.CfnParameter(this, 'srcRegion', {
      description: 'Source Region Name (only required if source type is Amazon ECR), for example, us-west-1',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Source Region', srcRegion.logicalId)

    // Only required for ECR
    const srcAccountId = new cdk.CfnParameter(this, 'srcAccountId', {
      description: 'Source AWS Account ID (only required if source type is Amazon ECR), leave it blank if source is in current account',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Source AWS Account ID', srcAccountId.logicalId)
    //
    const srcList = new cdk.CfnParameter(this, 'srcList', {
      description: 'Source Image Type, either ALL or SELECTED',
      type: 'String',
      default: 'ALL',
      allowedValues: ['ALL', 'SELECTED']
    })
    this.addToParamLabels('Type of Source Image List', srcList.logicalId)

    const srcImageList = new cdk.CfnParameter(this, 'srcImageList', {
      description: 'Selected Image List delimited by comma, for example, ubuntu:latest,alpine:latest...',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Source Image List delimited by comma', srcImageList.logicalId)

    // Currently, only required if source type is ECR
    const srcCredential = new cdk.CfnParameter(this, 'srcCredential', {
      description: 'The secret\'s name Secrets Manager used to keep credentials to pull images from source',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Source Credentials Name in Secrets Managers', srcCredential.logicalId)


    const destRegion = new cdk.CfnParameter(this, 'destRegion', {
      description: 'Destination AWS Region Name, for example, cn-north-1',
      type: 'String',
    })
    this.addToParamLabels('Destination AWS Region', destRegion.logicalId)

    const destAccountId = new cdk.CfnParameter(this, 'destAccountId', {
      description: 'Destination AWS Account ID, leave it blank if destination is in current account',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Destination AWS Account ID', destAccountId.logicalId)

    const destPrefix = new cdk.CfnParameter(this, 'destPrefix', {
      description: 'Destination Repo Prefix',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Destination Repo Prefix', destPrefix.logicalId)

    const destCredential = new cdk.CfnParameter(this, 'destCredential', {
      description: 'The secret\'s name Secrets Manager used to keep destination credentials to push images to Amazon ECR',
      type: 'String',
      default: '',
    })
    this.addToParamLabels('Destination Credentials Name in Secrets Managers', destCredential.logicalId)

    const ecsClusterName = new cdk.CfnParameter(this, 'ecsClusterName', {
      description: 'ECS Cluster Name to run ECS task (Please make sure the cluster exists)',
      type: 'String'
    })
    this.addToParamLabels('ECS Cluster Name', ecsClusterName.logicalId)

    const ecsVpcId = new cdk.CfnParameter(this, 'ecsVpcId', {
      description: 'VPC ID to run ECS task, e.g. vpc-bef13dc7',
      type: 'AWS::EC2::VPC::Id'
    })
    this.addToParamLabels('VPC ID to run ECS task', ecsVpcId.logicalId)

    // const ecsSubnets = new cdk.CfnParameter(this, 'ecsSubnets', {
    //   description: 'Subnet IDs to run ECS task. Please provide two subnets at least delimited by comma, e.g. subnet-97bfc4cd,subnet-7ad7de32',
    //   default: '',
    //   type: 'List<AWS::EC2::Subnet::Id>'
    // })

    const ecsSubnetA = new cdk.CfnParameter(this, 'ecsSubnetA', {
      description: 'Subnet IDs to run ECS task.',
      type: 'AWS::EC2::Subnet::Id'
    })
    this.addToParamLabels('Subnet ID', ecsSubnetA.logicalId)

    const ecsSubnetB = new cdk.CfnParameter(this, 'ecsSubnetB', {
      description: 'Subnet IDs to run ECS task.',
      type: 'AWS::EC2::Subnet::Id'
    })
    this.addToParamLabels('Subnet ID', ecsSubnetB.logicalId)

    const alarmEmail = new cdk.CfnParameter(this, 'alarmEmail', {
      description: 'Alarm Email address to receive notification in case of any failure',
      // default: '',
      allowedPattern: '\\w[-\\w.+]*@([A-Za-z0-9][-A-Za-z0-9]+\\.)+[A-Za-z]{2,14}',
      type: 'String',
    })
    this.addToParamLabels('alarm Email address', alarmEmail.logicalId)

    this.addToParamGroups('Type', sourceType.logicalId)
    this.addToParamGroups('Source Information', srcRegion.logicalId, srcAccountId.logicalId, srcList.logicalId, srcImageList.logicalId, srcCredential.logicalId)
    this.addToParamGroups('Destination Information', destRegion.logicalId, destAccountId.logicalId, destPrefix.logicalId, destCredential.logicalId)
    this.addToParamGroups('ECS Cluster Information', ecsClusterName.logicalId, ecsVpcId.logicalId, ecsSubnetA.logicalId, ecsSubnetB.logicalId)
    this.addToParamGroups('Notification Information', alarmEmail.logicalId)

    this.templateOptions.description = `(SO8003) - Data Transfer Hub - ECR Plugin Cloudformation Template version ${VERSION}`;
    
    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: this.paramGroups,
        ParameterLabels: this.paramLabels,
      }
    }

    const isSelectedImage = new cdk.CfnCondition(this, 'isSelectedImage', {
      expression: cdk.Fn.conditionEquals('SELECTED', srcList),
    });

    // const isSourcePublic = new cdk.CfnCondition(this, 'isSourcePublic', {
    //   expression: cdk.Fn.conditionEquals('Public', sourceType),
    // });

    const isSrcInCurrentAccount = new cdk.CfnCondition(this, 'isSrcInCurrentAccount', {
      expression: cdk.Fn.conditionAnd(
        // Source Account ID is blank
        cdk.Fn.conditionEquals('', srcAccountId),
        // Source Type is Amazon ECR
        cdk.Fn.conditionEquals('Amazon_ECR', sourceType)),

    });

    const isDestInCurrentAccount = new cdk.CfnCondition(this, 'isDestInCurrentAccount', {
      // Destination in Current Account
      expression: cdk.Fn.conditionEquals('', destAccountId),
    });

    const selectedImages = cdk.Fn.conditionIf(isSelectedImage.logicalId, srcImageList.valueAsString, 'Not Applicable').toString();


    // Set up SSM for selected image list
    const selectedImageParam = new ssm.StringParameter(this, 'selectedImageParam', {
      description: `Parameter to store the selected image list delimited by comma for stack ${cdk.Aws.STACK_NAME}`,
      // parameterName: 'SelectedImageList',
      stringValue: selectedImages,
    });

    // const cfnParam = selectedImageParam.node.defaultChild as ssm.CfnParameter
    // cfnParam.cfnOptions.condition = isSelectedImage

    // Setup DynamoDB
    const imageTable = new ddb.Table(this, 'ECRMigrationTable', {
      partitionKey: { name: 'Image', type: ddb.AttributeType.STRING },
      sortKey: { name: 'Tag', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    })

    const cfnTable = imageTable.node.defaultChild as ddb.CfnTable
    addCfnNagSuppressRules(cfnTable, [
      {
        id: 'W74',
        reason: 'This table is set to use DEFAULT encryption, the key is owned by DDB.'
      },
    ])

    const listImagesLambda = new lambda.Function(this, 'ListImagesFunction', {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      // tracing: lambda.Tracing.ACTIVE,
      environment: {
        SOURCE_TYPE: sourceType.valueAsString,
        SRC_ACCOUNT_ID: srcAccountId.valueAsString,
        SRC_LIST: srcList.valueAsString,
        SRC_REGION: srcRegion.valueAsString,
        SRC_CREDENTIAL_NAME: srcCredential.valueAsString,
        SELECTED_IMAGE_PARAM: selectedImageParam.parameterName,
      }
    });

    const srcSecretParam = secretsmanager.Secret.fromSecretNameV2(this, 'srcSecretParam', srcCredential.valueAsString);
    const desSecretParam = secretsmanager.Secret.fromSecretNameV2(this, 'desSecretParam', destCredential.valueAsString);

    listImagesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ],
        resources: [
          `arn:${cdk.Aws.PARTITION}:ecr:${srcRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`
        ]
      })
    );

    selectedImageParam.grantRead(listImagesLambda);
    srcSecretParam.grantRead(listImagesLambda);

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ECSVpc', {
      vpcId: ecsVpcId.valueAsString,
      availabilityZones: cdk.Fn.getAzs(),
      publicSubnetIds: [ecsSubnetA.valueAsString, ecsSubnetB.valueAsString]
      // publicSubnetIds: ecsSubnets.valueAsList
    })

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'ECSCluster', {
      clusterName: ecsClusterName.valueAsString,
      vpc: vpc,
      securityGroups: []
    })

    const containerlogGroup = new logs.LogGroup(this, `DTH-ECR-Container-LogGroup`, {
      retention: 365
    });
    const cfncontainerlogGroup = containerlogGroup.node.defaultChild as logs.CfnLogGroup
    addCfnNagSuppressRules(cfncontainerlogGroup, [
      {
        id: 'W84',
        reason: 'Log group data is always encrypted in CloudWatch Logs using an AWS Managed KMS Key'
      },
    ])

    // Create ECS executionRole and executionPolicy
    const ecsTaskExecutionRole = new iam.Role(this, `DTH-ECR-ecrTaskExecutionRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    const taskExecutionPolicy = new iam.Policy(this, 'TaskExecutionPolicy', {
      policyName: `${cdk.Aws.STACK_NAME}TaskExecutionPolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            containerlogGroup.logGroupArn
          ]
        }),
      ]
    });
    taskExecutionPolicy.node.addDependency(containerlogGroup);
    taskExecutionPolicy.attachToRole(ecsTaskExecutionRole);

    const taskDefinition = new ecs.TaskDefinition(this, 'ECRReplicationTask', {
      memoryMiB: '1024',
      cpu: '512',
      compatibility: ecs.Compatibility.FARGATE,
      family: `${cdk.Aws.STACK_NAME}-ECRReplicationTask`,
      executionRole: ecsTaskExecutionRole.withoutPolicyUpdates()
    });
    srcSecretParam.grantRead(taskDefinition.taskRole);
    desSecretParam.grantRead(taskDefinition.taskRole);

    const ecrContainer = `public.ecr.aws/aws-gcr-solutions/data-transfer-hub-ecr:${VERSION}`

    const containerDefinition = taskDefinition.addContainer('ECRReplicationContainer', {
      image: ecs.ContainerImage.fromRegistry(ecrContainer),
      environment: {
        SOURCE_TYPE: sourceType.valueAsString,
        AWS_DEFAULT_REGION: this.region,
        AWS_ACCOUNT_ID: this.account,
        SRC_REGION: srcRegion.valueAsString,
        SRC_ACCOUNT_ID: srcAccountId.valueAsString,
        SRC_CREDENTIAL_NAME: srcCredential.valueAsString,
        DEST_REGION: destRegion.valueAsString,
        DEST_ACCOUNT_ID: destAccountId.valueAsString,
        DEST_PREFIX: destPrefix.valueAsString,
        DEST_CREDENTIAL_NAME: destCredential.valueAsString,

      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'DRH-ECR-replication',
        logGroup: containerlogGroup,
      })
    });


    const ecrSrcReadOnlyPolicy = new iam.Policy(this, 'ECRSrcReadOnlyPolicy', {
      policyName: `${cdk.Aws.STACK_NAME}ECRSrcReadOnlyPolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ecr:GetAuthorizationToken",
          ],
          resources: [
            '*'
          ]
        }),
        new iam.PolicyStatement({
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:ecr:${srcRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`

          ]
        }),
      ]
    });

    const cfnecrSrcReadOnlyPolicy = ecrSrcReadOnlyPolicy.node.defaultChild as iam.CfnPolicy
    addCfnNagSuppressRules(cfnecrSrcReadOnlyPolicy, [
      {
        id: 'W12',
        reason: 'This IAM policy need * resource'
      },
    ])

    const ecrSrcPolicy = ecrSrcReadOnlyPolicy.node.defaultChild as iam.CfnPolicy
    ecrSrcPolicy.cfnOptions.condition = isSrcInCurrentAccount

    ecrSrcReadOnlyPolicy.attachToRole(taskDefinition.taskRole);

    const ecrDestWritePolicy = new iam.Policy(this, 'ECRDestWritePolicy', {
      policyName: `${cdk.Aws.STACK_NAME}ECRDestWritePolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ecr:GetAuthorizationToken",
          ],
          resources: [
            '*'
          ]
        }),
        new iam.PolicyStatement({
          actions: [
            "ecr:CreateRepository",
            "ecr:CompleteLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:ecr:${destRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`

          ]
        }),
      ]
    });
    const cfnecrDestWritePolicy = ecrDestWritePolicy.node.defaultChild as iam.CfnPolicy
    addCfnNagSuppressRules(cfnecrDestWritePolicy, [
      {
        id: 'W12',
        reason: 'This IAM policy need * resource'
      },
    ])

    const ecrDestPolicy = ecrDestWritePolicy.node.defaultChild as iam.CfnPolicy
    ecrDestPolicy.cfnOptions.condition = isDestInCurrentAccount
    ecrDestWritePolicy.attachToRole(taskDefinition.taskRole);


    const submitJob = new tasks.LambdaInvoke(this, 'Submit Lambda', {
      lambdaFunction: listImagesLambda,
      // Lambda's result is in the attribute `Payload`
      outputPath: '$.Payload'
    });

    const clusterSG = new ec2.SecurityGroup(this, 'clusterSG', {
      allowAllOutbound: true,
      description: `SG for ${cdk.Aws.STACK_NAME} Fargate Tasks`,
      vpc: vpc,
    });
    const cfnclusterSG = clusterSG.node.defaultChild as ec2.CfnSecurityGroup
    addCfnNagSuppressRules(cfnclusterSG, [
      {
        id: 'W5',
        reason: 'Egress of 0.0.0.0/0 is required'
      },
      {
        id: 'W40',
        reason: 'Egress IPProtocol of -1 is required'
      },
    ])

    const runTask = new tasks.EcsRunTask(this, 'Run Fargate Task', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster,
      taskDefinition,
      assignPublicIp: true,
      containerOverrides: [{
        containerDefinition,
        environment: [
          { name: 'IMAGE', value: sfn.JsonPath.stringAt('$.repositoryName') },
          { name: 'TAG', value: sfn.JsonPath.stringAt('$.imageTag') },
        ],
      }],
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      resultPath: '$.result',
      securityGroups: [clusterSG]
    });


    const putSuccessInDDBTask = new tasks.DynamoPutItem(this, 'Log Success in DynamoDB', {
      item: {
        Image: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.repositoryName')),
        Tag: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.imageTag')),
        Execution: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.Execution.Name')),
        // StartedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StartedAt')),
        // StoppedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StoppedAt')),
        Status: tasks.DynamoAttributeValue.fromString('Done'),
      },
      table: imageTable,
      returnValues: tasks.DynamoReturnValues.NONE,
      resultPath: '$.result'
    });

    const putFailureInDDBTask = new tasks.DynamoPutItem(this, 'Log Failure in DynamoDB', {
      item: {
        Image: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.repositoryName')),
        Tag: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.imageTag')),
        Execution: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.Execution.Name')),
        // StartedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StartedAt')),
        // StoppedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StoppedAt')),
        ErrorMessage: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.result.Error')),
        Status: tasks.DynamoAttributeValue.fromString('Error'),
      },
      table: imageTable,
      returnValues: tasks.DynamoReturnValues.NONE,
      resultPath: '$.result'
    });

    const myKeyAlias = kms.Alias.fromAliasName(this, 'AwsSnsDefaultKey', 'alias/aws/sns');

    const topic = new sns.Topic(this,
      'EcrReplicationTopic',
      {
        masterKey: myKeyAlias,
      }
    );
    topic.addSubscription(new subscriptions.EmailSubscription(alarmEmail.valueAsString));

    const snsTask = new tasks.SnsPublish(this, 'Publish To SNS', {
      topic,
      integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
      message: sfn.TaskInput.fromObject({
        error: "Failed to copy image",
        execution: sfn.JsonPath.stringAt('$$.Execution.Name'),
        image: sfn.JsonPath.stringAt('$.repositoryName'),
        tag: sfn.JsonPath.stringAt('$.imageTag'),
      })
    });

    const endState = new sfn.Pass(this, 'EndState');

    const map = new sfn.Map(this, 'Map State', {
      maxConcurrency: 10,
      itemsPath: sfn.JsonPath.stringAt('$.Payload'),
    });

    const retryParam: sfn.RetryProps = {
      backoffRate: 2,
      interval: cdk.Duration.seconds(60),
      maxAttempts: 3,
    }

    map.iterator(runTask
      .addRetry(retryParam)
      .addCatch(putFailureInDDBTask.next(snsTask), { resultPath: '$.result' })
      .next(putSuccessInDDBTask));

    submitJob.next(map).next(endState)

    const logGroup = new logs.LogGroup(this, `DTH-ECR-StepFunction-LogGroup`);

    // Create role for Step Machine
    const ecrStateMachineRole = new iam.Role(this, `DTH-ECR-ecrStateMachineRole`, {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com')
    });
    const ecrStateMachineRolePolicy = new iam.Policy(this, 'ecrStateMachineRolePolicy');

    ecrStateMachineRolePolicy.addStatements(
      new iam.PolicyStatement({
        actions: [
          'lambda:InvokeFunction'
        ],
        resources: [
          listImagesLambda.functionArn
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          'ecs:RunTask'
        ],
        resources: [
          taskDefinition.taskDefinitionArn
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          "ecs:StopTask",
          "ecs:DescribeTasks"
        ],
        resources: [
          '*'
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          "iam:PassRole"
        ],
        resources: [
          taskDefinition.taskRole.roleArn,
          taskDefinition.executionRole!.roleArn
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          "dynamodb:PutItem"
        ],
        resources: [
          imageTable.tableArn
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          "sns:Publish"
        ],
        resources: [
          topic.topicArn
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          "events:PutTargets",
          "events:PutRule",
          "events:DescribeRule"
        ],
        resources: [
          `arn:${cdk.Aws.PARTITION}:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:rule/StepFunctionsGetEventsForECSTaskRule`,
        ]
      }),
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogDelivery',
          'logs:GetLogDelivery',
          'logs:UpdateLogDelivery',
          'logs:DeleteLogDelivery',
          'logs:ListLogDeliveries',
          'logs:PutResourcePolicy',
          'logs:DescribeResourcePolicies',
          'logs:DescribeLogGroups'
        ],
        resources: [
          '*'
        ]
      }),
    );
    ecrStateMachineRolePolicy.node.addDependency(listImagesLambda, taskDefinition, imageTable, topic, logGroup);
    ecrStateMachineRolePolicy.attachToRole(ecrStateMachineRole);
    const cfnecrStateMachineRolePolicy = ecrStateMachineRolePolicy.node.defaultChild as iam.CfnPolicy
    addCfnNagSuppressRules(cfnecrStateMachineRolePolicy, [
      {
        id: 'W12',
        reason: '[*] Access granted as per documentation: https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html'
      },
      {
        id: 'W76',
        reason: 'SPCM complexity greater then 25 is appropriate for the logic implemented'
      }
    ])

    const ecrStateMachine = new sfn.StateMachine(this, 'ECRReplicationStateMachine', {
      stateMachineName: `${cdk.Aws.STACK_NAME}-ECRReplicationSM`,
      role: ecrStateMachineRole.withoutPolicyUpdates(),
      definition: submitJob,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
      }
    });
    const cfnlogGroup = logGroup.node.defaultChild as logs.CfnLogGroup
    addCfnNagSuppressRules(cfnlogGroup, [
      {
        id: 'W84',
        reason: 'Log group data is always encrypted in CloudWatch Logs using an AWS Managed KMS Key'
      },
    ])

    ecrStateMachine.node.addDependency(containerDefinition, taskDefinition, submitJob, logGroup, ecrStateMachineRole, ecrStateMachineRolePolicy)

    const smRuleRole = new iam.Role(this, 'ECRReplicationSMExecRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    })
    smRuleRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "states:StartExecution",
      ],
      resources: [
        ecrStateMachine.stateMachineArn,
      ]
    }))

    const ecrStateMachineTarget = new SfnStateMachine(ecrStateMachine, { role: smRuleRole });
    const smRule = new Rule(this, 'ECRReplicationScheduleRule', {
      schedule: Schedule.rate(cdk.Duration.days(1)),
      targets: [ecrStateMachineTarget],
    });
    smRule.node.addDependency(ecrStateMachine, smRuleRole)

    const checkExecutionLambdaPolicy = new iam.Policy(this, 'CheckExecutionLambdaPolicy', {
      policyName: `${cdk.Aws.STACK_NAME}CheckExecutionLambdaPolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "states:StartExecution",
            "states:ListExecutions",
            "states:ListStateMachines",
            "states:DescribeExecution",
            "states:DescribeStateMachineForExecution",
            "states:GetExecutionHistory",
            "states:ListActivities",
            "states:DescribeStateMachine",
            "states:DescribeActivity",
          ],
          resources: [
            '*'
          ]
        }),
      ]
    });

    const cfncheckExecutionLambdaPolicy = checkExecutionLambdaPolicy.node.defaultChild as iam.CfnPolicy
    addCfnNagSuppressRules(cfncheckExecutionLambdaPolicy, [
      {
        id: 'W12',
        reason: 'This IAM policy need * resource'
      },
    ])

    const checkExecutionLambdaRole = new iam.Role(this, 'CheckExecutionFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })

    const checkExecutionLambda = new lambda.Function(this, 'CheckExecutionFunction', {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'step-func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      // tracing: lambda.Tracing.ACTIVE,
      environment: {
        STATE_MACHINE_ARN: ecrStateMachine.stateMachineArn
      },
      role: checkExecutionLambdaRole.withoutPolicyUpdates()
    });
    checkExecutionLambda.node.addDependency(checkExecutionLambdaRole, checkExecutionLambdaPolicy)

    checkExecutionLambdaPolicy.attachToRole(checkExecutionLambda.role!)
    ecrStateMachine.grantStartExecution(checkExecutionLambda)
    ecrStateMachine.grantRead(checkExecutionLambda)

    //Run checkExecutionLambda on Create
    const lambdaTrigger = new cr.AwsCustomResource(this, 'StatefunctionTrigger', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        effect: iam.Effect.ALLOW,
        resources: [checkExecutionLambda.functionArn]
      })]),
      timeout: cdk.Duration.minutes(15),
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: checkExecutionLambda.functionName,
          InvocationType: 'Event'
        },
        physicalResourceId: cr.PhysicalResourceId.of('JobSenderTriggerPhysicalId')
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: checkExecutionLambda.functionName,
          InvocationType: 'Event'
        },
        physicalResourceId: cr.PhysicalResourceId.of('JobSenderTriggerPhysicalId')
      }
    })
    lambdaTrigger.node.addDependency(ecrStateMachine, smRule)
  }
}
