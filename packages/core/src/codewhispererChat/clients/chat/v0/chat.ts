/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { SendMessageCommandOutput, SendMessageRequest } from '@amzn/amazon-q-developer-streaming-client'
import {
    GenerateAssistantResponseCommandOutput,
    GenerateAssistantResponseRequest,
    ToolUse,
} from '@amzn/codewhisperer-streaming'
import * as vscode from 'vscode'
import { ToolkitError } from '../../../../shared/errors'
import { createCodeWhispererChatStreamingClient } from '../../../../shared/clients/codewhispererChatClient'
import { createQDeveloperStreamingClient } from '../../../../shared/clients/qDeveloperChatClient'
import { UserWrittenCodeTracker } from '../../../../codewhisperer/tracker/userWrittenCodeTracker'

export class ChatSession {
    private sessionId?: string
    /**
     * _listOfReadFiles = list of files read from the project to gather context before generating response.
     * _filePath = The path helps the system locate exactly where to make the necessary changes in the project structure
     * _tempFilePath = Used to show the code diff view in the editor including LLM changes.
     */
    private _listOfReadFiles: string[] = []
    private _filePath: string | undefined
    private _tempFilePath: string | undefined
    private _toolUse: ToolUse | undefined

    contexts: Map<string, { first: number; second: number }[]> = new Map()
    // TODO: doesn't handle the edge case when two files share the same relativePath string but from different root
    // e.g. root_a/file1 vs root_b/file1
    relativePathToWorkspaceRoot: Map<string, string> = new Map()
    public get sessionIdentifier(): string | undefined {
        return this.sessionId
    }

    public get toolUse(): ToolUse | undefined {
        return this._toolUse
    }

    public setToolUse(toolUse: ToolUse | undefined) {
        this._toolUse = toolUse
    }

    public tokenSource!: vscode.CancellationTokenSource

    constructor() {
        this.createNewTokenSource()
    }

    createNewTokenSource() {
        this.tokenSource = new vscode.CancellationTokenSource()
    }

    public setSessionID(id?: string) {
        this.sessionId = id
    }
    public get listOfReadFiles(): string[] {
        return this._listOfReadFiles
    }
    public get filePath(): string | undefined {
        return this._filePath
    }
    public get tempFilePath(): string | undefined {
        return this._tempFilePath
    }
    public setFilePath(filePath: string | undefined) {
        this._filePath = filePath
    }
    public setTempFilePath(tempFilePath: string | undefined) {
        this._tempFilePath = tempFilePath
    }
    public pushToListOfReadFiles(filePath: string) {
        this._listOfReadFiles.push(filePath)
    }
    public clearListOfReadFiles() {
        this._listOfReadFiles = []
    }
    async chatIam(chatRequest: SendMessageRequest): Promise<SendMessageCommandOutput> {
        const client = await createQDeveloperStreamingClient()

        const response = await client.sendMessage(chatRequest)
        if (!response.sendMessageResponse) {
            throw new ToolkitError(
                `Empty chat response. Session id: ${this.sessionId} Request ID: ${response.$metadata.requestId}`
            )
        }

        const responseStream = response.sendMessageResponse
        for await (const event of responseStream) {
            if ('messageMetadataEvent' in event) {
                this.sessionId = event.messageMetadataEvent?.conversationId
                break
            }
        }

        UserWrittenCodeTracker.instance.onQFeatureInvoked()
        return response
    }

    async chatSso(chatRequest: GenerateAssistantResponseRequest): Promise<GenerateAssistantResponseCommandOutput> {
        const client = await createCodeWhispererChatStreamingClient()

        const response = await client.generateAssistantResponse(chatRequest)
        if (!response.generateAssistantResponseResponse) {
            throw new ToolkitError(
                `Empty chat response. Session id: ${this.sessionId} Request ID: ${response.$metadata.requestId}`
            )
        }

        this.sessionId = response.conversationId

        UserWrittenCodeTracker.instance.onQFeatureInvoked()

        return response
    }
}
