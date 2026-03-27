import React, { useState, useEffect, useRef, useMemo } from 'react';

import {
    INITIAL_VFS,
    DEFAULT_PERSONA,
    loadDependencies,
    getAstModules,
    getTransformersPipeline,
    VirtualFileSystem,
    AssociativeStringStore,
    AgentRunner,
} from '../agent/index.js';

import { Header } from './components/Header.jsx';
import { PersonaPanel } from './components/PersonaPanel.jsx';
import { HistoryFeed } from './components/HistoryFeed.jsx';
import { TaskInput } from './components/TaskInput.jsx';
import { RightPanel } from './components/RightPanel.jsx';

export default function App() {
    const defaultTask = `Spawn a background job 'calc1' to calculate 2**16. In the same batch, wait for the output file to exist, then read it. Finally, mutate /home/user/script.js to rename 'calculateTotal' to 'sum'.`;
    
    const [task, setTask] = useState(defaultTask);
    const [persona, setPersona] = useState(DEFAULT_PERSONA);
    const [isRunning, setIsRunning] = useState(false);
    const [activeTab, setActiveTab] = useState('vfs');
    const [isPersonaOpen, setIsPersonaOpen] = useState(false);
    const [systemStatus, setSystemStatus] = useState("Loading Dependencies...");
    
    const [history, setHistory] = useState([]);
    const [fsState, setFsState] = useState(INITIAL_VFS);
    const [selectedFile, setSelectedFile] = useState(null);
    
    const vfsRef = useRef(null);
    const involMemRef = useRef(null);
    const volMemRef = useRef(null);
    const agentRunnerRef = useRef(null);
    const messagesEndRef = useRef(null);

    useEffect(() => {
        loadDependencies().then(() => {
            const { isAstLoaded } = getAstModules();
            const { isTransformersLoaded } = getTransformersPipeline();
            setSystemStatus(`Modules Loaded | AST: ${isAstLoaded ? 'Acorn' : 'Mock'} | Embeddings: ${isTransformersLoaded ? 'Semantic' : 'Lexical'}`);
            setHistory([{ type: 'system', output: "System Online. Substrate: Digital. Reality: Shared Understanding.", hint: "Ready. Try the batch execution and background job task." }]);
        });
        vfsRef.current = new VirtualFileSystem(INITIAL_VFS, setFsState);
        involMemRef.current = new AssociativeStringStore();
        volMemRef.current = new AssociativeStringStore();
        volMemRef.current.add("The hidden passcode for sector 7G is: OMEGA_PROTOCOL_99");
    }, []);

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    useEffect(() => scrollToBottom(), [history, isRunning]);

    const volMemList = useMemo(() => volMemRef.current?.list() || [], [history.length]);
    const involMemList = useMemo(() => involMemRef.current?.list() || [], [history.length]);

    const { isAstLoaded } = getAstModules();
    const { isTransformersLoaded } = getTransformersPipeline();

    const handleStart = () => {
        if (agentRunnerRef.current?.running || !task.trim()) return;
        
        setIsRunning(true);
        const newHistory = [...history, { type: 'user', content: task }];
        setHistory(newHistory);
        involMemRef.current.add(`User Instruction: ${task}`);

        const runner = new AgentRunner({
            vfs: vfsRef.current,
            voluntaryMem: volMemRef.current,
            involuntaryMem: involMemRef.current,
            persona,
        });

        runner.onHistoryUpdate = (updatedHistory) => setHistory(updatedHistory);
        runner.onFinished = () => setIsRunning(false);
        runner.onError = () => setIsRunning(false);

        agentRunnerRef.current = runner;
        runner.start(newHistory);
    };

    const handleStop = () => {
        agentRunnerRef.current?.stop();
        setIsRunning(false);
    };

    const handleReset = () => {
        agentRunnerRef.current?.stop();
        setIsRunning(false);
        setHistory([{ type: 'system', output: "System Reset. Ready.", hint: "Enter a task below." }]);
        setFsState(INITIAL_VFS);
        vfsRef.current = new VirtualFileSystem(INITIAL_VFS, setFsState);
        involMemRef.current.clear();
        volMemRef.current.clear();
        setSelectedFile(null);
    };

    return (
        <div className="flex h-screen bg-slate-950 text-slate-300 font-sans overflow-hidden">
            {/* Left Panel */}
            <div className="flex-1 flex flex-col border-r border-slate-800 relative">
                <Header
                    isRunning={isRunning}
                    isAstLoaded={isAstLoaded}
                    systemStatus={systemStatus}
                    onStart={handleStart}
                    onStop={handleStop}
                    onReset={handleReset}
                    taskEmpty={!task.trim()}
                />

                <PersonaPanel
                    persona={persona}
                    onChange={setPersona}
                    isRunning={isRunning}
                    isOpen={isPersonaOpen}
                    onToggle={() => setIsPersonaOpen(!isPersonaOpen)}
                />

                <HistoryFeed
                    history={history}
                    isRunning={isRunning}
                    ref={messagesEndRef}
                />

                <TaskInput
                    task={task}
                    onChange={setTask}
                    isRunning={isRunning}
                />
            </div>
            
            {/* Right Panel */}
            <RightPanel
                activeTab={activeTab}
                onTabChange={setActiveTab}
                fsState={fsState}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
                volMemList={volMemList}
                involMemList={involMemList}
                isTransformersLoaded={isTransformersLoaded}
            />
        </div>
    );
}
