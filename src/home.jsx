    // Where the "Get Access" buttons go. Set in config.js, falls back to /projects/
    const PROJECTS_PATH = String((window.PLUGINFORGE_CONFIG && window.PLUGINFORGE_CONFIG.projectsPath) || 'projects').replace(/^\/+|\/+$/g, '');
    const PROJECTS_URL = '/' + PROJECTS_PATH + '/';

    function App() {
        const promptExamples = [
            "Create a prison mine plugin with rank progression and automated resets.",
            "Build a custom lifesteal system with heart crafting recipes and revive beacons.",
            "Design an automated economy plugin with player shops and Vault integration.",
            "Create a claims plugin with trust levels, sub-claims, and clean chat notifications.",
            "Build an RPG class selector with mana regeneration, custom spells, and cooldowns.",
            "Generate a guild/clan system with territory wars, shared bank, and chat channels."
        ];

        const [displayedPrompt, setDisplayedPrompt] = React.useState('');
        const [openFaq, setOpenFaq] = React.useState(null);
        const [mousePos, setMousePos] = React.useState({ x: 50, y: 30 });
        const [activeLegalModal, setActiveLegalModal] = React.useState(null); // 'privacy' | 'terms' | null

        // Prevent background page scrolling when a modal is open
        React.useEffect(() => {
            if (activeLegalModal) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
            return () => {
                document.body.style.overflow = '';
            };
        }, [activeLegalModal]);

        const handleMouseMove = (e) => {
            const { clientX, clientY } = e;
            const { innerWidth, innerHeight } = window;
            setMousePos({
                x: Math.round((clientX / innerWidth) * 100),
                y: Math.round((clientY / innerHeight) * 100)
            });
        };

        const promptContainerRef = React.useRef(null);

        React.useEffect(() => {
            if (promptContainerRef.current) {
                promptContainerRef.current.scrollLeft = promptContainerRef.current.scrollWidth;
            }
        }, [displayedPrompt]);

        React.useEffect(() => {
            let exampleIndex = 0;
            let charIndex = 0;
            let isDeleting = false;
            let timeoutId = null;

            const typeEffect = () => {
                const currentFullText = promptExamples[exampleIndex];

                if (!isDeleting) {
                    setDisplayedPrompt(currentFullText.slice(0, charIndex + 1));
                    charIndex++;

                    if (charIndex === currentFullText.length) {
                        isDeleting = true;
                        timeoutId = setTimeout(typeEffect, 2500);
                        return;
                    }
                    timeoutId = setTimeout(typeEffect, 40);
                } else {
                    setDisplayedPrompt(currentFullText.slice(0, charIndex - 1));
                    charIndex--;

                    if (charIndex === 0) {
                        isDeleting = false;
                        exampleIndex = (exampleIndex + 1) % promptExamples.length;
                        timeoutId = setTimeout(typeEffect, 400);
                        return;
                    }
                    timeoutId = setTimeout(typeEffect, 20);
                }
            };

            timeoutId = setTimeout(typeEffect, 500);
            return () => clearTimeout(timeoutId);
        }, []);

        return (
            <div
                onMouseMove={handleMouseMove}
                className="min-h-screen bg-[#26282B] text-[#f4f4f5] flex flex-col font-sans relative overflow-x-hidden"
            >
                {/* Subtle Dot Grid Background Pattern */}
                <div className="fixed inset-0 bg-grid-pattern opacity-30 pointer-events-none z-0"></div>

                {/* Subtle Interactive Radial Spotlight */}
                <div
                    className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-500"
                    style={{
                        background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, rgba(58, 61, 66, 0.35), transparent 80%)`
                    }}
                ></div>

                {/* Header / Navbar */}
                <header className="py-5 px-6 sm:px-8 border-b border-[#3A3D42] sticky top-0 bg-[#26282B]/90 backdrop-blur-md z-50">
                    <div className="max-w-6xl mx-auto flex items-center justify-between">
                        <a href="#" className="flex items-center gap-2.5">
                            <svg className="h-7 w-auto shrink-0" viewBox="200 252 827 627" fill="#ffffff" aria-hidden="true"><path d="M345.55 297.7 C345.68 308.49 343.88 339.94 347.18 348.42 C349.5 354.39 368.8 362.85 373.55 369.33 C375.49 371.99 379.8 407.78 380.54 413.67 L389.55 411.78 L389.05 357.72 L374.05 343.72 L374.05 288.39 C396.97 280.76 420.61 275.06 443.76 268.13 C453.85 265.11 471.13 258.11 480.9 257.27 C499.27 255.69 519.18 259.84 537.39 262.07 C562.52 265.15 587.78 267.53 612.95 270.26 C699.14 279.58 785.54 287.98 871.55 298.72 L871.05 344.97 L846.05 357.47 C846.05 370.28 846.64 382.94 847.55 395.72 L857.03 394.1 L858.05 368.66 C869.45 361.67 881.07 354.96 893.05 348.97 L893.55 307.88 L1022.55 324.72 L1022.55 392.64 C1011.15 396.07 1000.4 401.8 989.38 406.23 C975.14 411.97 958.94 416.84 946.06 425.3 L945.04 464.06 C922.3 474.25 897.68 479.98 875.05 490.41 L874.04 547.97 C866.85 551.57 849.78 560.17 842.07 559.15 C836.55 558.42 822.59 550.74 817.05 547.97 L816.04 500.11 C796.5 490.12 774.97 484.17 755.06 475.04 L754.03 444.25 C698.19 440.53 642.42 435.64 586.62 431.3 C570.83 430.08 555.04 428.93 539.26 427.61 C527.46 426.63 514.63 424.82 502.82 426.3 C495.75 427.18 488.52 431.13 481.68 433.15 C454.69 441.15 428.4 451.64 401.55 459.81 L401.55 503.45 C394.28 506.45 376.26 517.67 369.92 518.18 C363.07 518.73 355.91 515.14 349.58 512.9 C335.61 507.96 321.09 501.55 306.55 498.66 C306.48 493.92 307.05 465.43 305.51 463.31 C302.91 459.74 283.69 454.6 278.69 452.93 C254.05 444.72 229.4 436.21 204.55 428.63 L204.55 337.72 C238.09 329.34 271.27 318.82 304.49 309.21 C318.03 305.29 331.65 300.17 345.55 297.7 Z"/><path d="M319.05 694.39 L376.05 675.05 L377.05 540.47 L426.04 515.97 L427.06 474.38 C441.47 469.61 456.06 465.46 470.63 461.17 C477.15 459.25 484.01 456.21 490.76 455.3 C498.27 454.3 506.45 455.53 513.97 456 C529.46 456.96 544.87 458.27 560.38 458.84 C614.43 460.85 668.48 463.37 722.55 464.72 L723.06 489.06 L791.55 514.98 L792.05 556.02 L840.05 575.38 L840.55 681.72 L904.04 692.29 L904.55 731.72 L764.05 727.21 L763.04 616.22 L741.05 606.05 C740.92 598.48 741.39 553.22 739.76 549.74 C738.11 546.2 709.09 526.75 703.89 523.32 C697.72 519.24 691.41 514.52 685.48 510.03 C683.35 508.42 680.8 505.38 678.35 504.42 C673.35 502.46 650.78 503.24 643.72 502.76 C617.3 501 590.58 498.22 564.11 498.22 C559.33 498.22 553.01 497.13 548.41 498.43 C545.47 499.26 542.56 501.93 539.94 503.48 C526.94 511.2 514.57 520.71 501.05 527.47 L500.55 571.64 L469.05 582.39 L468.55 713.72 C452 713.2 434.09 711.38 417.62 713.3 C406.92 714.55 396.11 717.71 385.54 719.82 C363.24 724.28 340.93 728.6 318.55 732.6 Z"/><path d="M503.05 651.72 C517.55 637.22 533.33 623.06 549.55 610.57 L549.55 670.48 C552.99 668.04 567.08 656.03 568.73 652.77 C570.82 648.64 569.87 623.01 570.05 616.72 C579.71 607.06 588.58 596.72 597.94 586.85 C601.18 583.42 608.19 578.93 609.84 574.52 C611.7 569.54 610.47 533.29 610.55 525.23 C627.92 542.56 647.6 557.52 665.05 574.71 L666.05 636.75 C671.68 642.23 678.04 648.98 684.55 653.42 L684.55 606.23 L722.05 642.72 L722.55 689.72 L733.55 689.72 L733.55 724.72 C707.86 724.37 682.22 723.58 656.55 722.72 L656.05 680.72 C645.84 670.51 634.85 661.41 624.56 651.26 C624.43 656.86 625.67 668.53 623.86 673.48 C622.93 676.02 596.58 699.48 593.05 701.68 L592.55 719.72 C562.52 719.18 532.56 717.79 502.55 716.72 Z"/><path d="M248.05 746.34 L301.55 735.81 L301.55 803.45 L323.05 789.77 L323.55 747.72 C352.11 744.14 380.5 736.63 408.71 730.99 C417.92 729.14 427.72 725.75 437.11 725.25 C462.53 723.9 488.42 726.88 513.79 728.29 C564.03 731.08 614.27 734.62 664.55 736.72 L664.05 806.72 C657.09 813.68 648.54 821.62 640.05 826.6 L639.04 863.2 C596.66 865.21 554.31 867.57 511.95 869.92 C489.21 871.18 466.06 873.8 443.28 873.21 C434.31 872.97 425.12 871.22 416.2 870.18 C399.39 868.23 382.57 866.44 365.78 864.37 C326.41 859.54 286.91 855.64 247.55 850.72 Z"/><path d="M666.05 826.72 C671.44 821.33 677.68 817.08 683.05 811.72 L683.55 752.8 C692.98 749.96 702.26 742.97 711.88 741.32 C722.98 739.42 741.71 741.22 753.62 741.22 C790.93 741.22 828.24 742.14 865.55 742.72 L865.55 805.43 L890.55 817 L890.55 864.72 L665.55 864.72 Z"/><path d="M978.05 747.24 L978.55 851.72 L915.55 856.72 C915.49 849.89 916.41 805 914.51 802.32 C912.19 799.03 891.88 790.38 887.05 787.97 L886.55 743.72 Z"/></svg>
                            <span className="font-bold tracking-tight text-base text-[#f4f4f5]">PluginForge</span>
                        </a>
                        <nav className="hidden md:flex items-center gap-6 text-xs text-[#a1a1aa]">
                            <a href="#overview" className="hover:text-[#f4f4f5] transition-colors">Overview</a>
                            <a href="#built-for" className="hover:text-[#f4f4f5] transition-colors">Built For</a>
                            <a href="#examples" className="hover:text-[#f4f4f5] transition-colors">Examples</a>
                            <a href="#faq" className="hover:text-[#f4f4f5] transition-colors">FAQ</a>
                        </nav>
                        <a href={PROJECTS_URL} className="bg-[#2C2E31] hover:bg-[#3A3D42] border border-[#3A3D42] text-[#f4f4f5] text-xs font-medium px-3.5 py-1.5 rounded transition-colors">
                            Get Access
                        </a>
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 relative z-10">
                    {/* Hero Section */}
                    <section className="py-20 sm:py-28 px-6 text-center">
                        <div className="max-w-3xl mx-auto">
                            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[#f4f4f5] leading-tight">
                                Build a Plugin in Minutes
                            </h1>
                            <div className="mt-6 max-w-xl mx-auto text-center">
                                <p className="text-xs sm:text-sm text-[#a1a1aa] leading-relaxed">
                                    Never coded in Java before? No problem. Describe what you want in plain English, and PluginForge instantly generates working Paper plugins ready for your server.
                                </p>
                            </div>

                            {/* Modern Prompt Box with Clickable Tags */}
                            <div className="mt-10 max-w-2xl mx-auto bg-[#2C2E31] border border-[#3A3D42] rounded-2xl p-3 sm:p-4 text-left shadow-xl">
                                <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center bg-[#26282B] border border-[#3A3D42] focus-within:border-[#71717a] rounded-xl p-2 transition-all">
                                    <div className="flex items-center flex-1 min-w-0 px-2 py-1.5">
                                        <div className="text-[#a1a1aa] mr-3 shrink-0">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" />
                                            </svg>
                                        </div>
                                        <input
                                            id="prompt-input"
                                            type="text"
                                            value={displayedPrompt}
                                            onChange={(e) => setDisplayedPrompt(e.target.value)}
                                            placeholder="Describe the plugin you want to generate..."
                                            className="w-full bg-transparent text-sm text-[#f4f4f5] placeholder-[#71717a] focus:outline-none font-sans"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#3A3D42] px-2 sm:px-0">
                                        <span className="text-[11px] font-mono text-[#71717a]">
                                            {displayedPrompt.length}/500
                                        </span>
                                        <button className="bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#26282B] p-2.5 rounded-lg transition-colors flex items-center justify-center shrink-0" aria-label="Build Plugin">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3.5 flex flex-wrap items-center gap-1.5 px-1">
                                    <span className="text-[11px] text-[#71717a] font-medium mr-1">Examples:</span>
                                    {[
                                        { label: "Economy System", text: "Create an economy plugin with Vault support and player trading." },
                                        { label: "Prison Mine", text: "Build a prison mine with rank progression and automated resets." },
                                        { label: "Land Claims", text: "Design a land claims system with trust permissions and borders." }
                                    ].map((item, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setDisplayedPrompt(item.text)}
                                            className="bg-[#26282B] hover:bg-[#3A3D42] border border-[#3A3D42] px-2.5 py-1 rounded-md text-[11px] text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors cursor-pointer"
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <a href="https://discord.gg/tBYx3QkwhH" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto bg-[#5865F2] hover:bg-[#4752C4] text-white text-sm font-semibold px-6 py-2.5 rounded transition-colors flex items-center justify-center gap-2">
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.011c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                                    </svg>
                                    <span>Join Discord Server</span>
                                </a>
                                <a href="#overview" className="w-full sm:w-auto bg-[#2C2E31] hover:bg-[#3A3D42] border border-[#3A3D42] text-[#f4f4f5] text-sm font-medium px-6 py-2.5 rounded transition-colors">
                                    Why PluginForge
                                </a>
                            </div>
                        </div>
                    </section>

                    {/* Overview */}
                    <section id="overview" className="py-20 px-6 border-t border-[#3A3D42]">
                        <div className="max-w-3xl mx-auto">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#f4f4f5] mb-6">
                                Skip the headache of learning Java first
                            </h2>
                            <div className="space-y-4 text-base text-[#a1a1aa] leading-relaxed">
                                <p>
                                    Making plugins used to mean wrestling with complex IDEs, setting up Gradle builds, and debugging confusing Java errors before you could even test a simple command on your server.
                                </p>
                                <p>
                                    PluginForge cuts straight to the fun part. Just tell it what you want your plugin to do, get a ready-to-use file, and drop it straight into your server's plugins folder.
                                </p>
                                <p>
                                    When you're ready to start learning how the code actually works, you can dive into the clean Java source files whenever you want.
                                </p>
                                <p className="text-[#f4f4f5] font-medium pt-2">
                                    Zero coding background needed to get started.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Built For */}
                    <section id="built-for" className="py-20 px-6 border-t border-[#3A3D42]">
                        <div className="max-w-4xl mx-auto">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#f4f4f5] mb-8">
                                Built For
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-[#2C2E31] border border-[#3A3D42] p-6 sm:p-8 rounded-lg flex flex-col justify-between">
                                    <div>
                                        <h3 className="text-lg font-medium text-[#f4f4f5] mb-3">New Developers</h3>
                                        <p className="text-sm text-[#a1a1aa] leading-relaxed mb-6">
                                            Learn faster by generating idiomatic Paper plugins you can read, modify, and experiment with.
                                        </p>
                                    </div>
                                    <div>
                                        <div className="text-xs font-mono uppercase tracking-wider text-[#71717a] mb-3">Great for:</div>
                                        <ul className="space-y-2 text-sm text-[#f4f4f5]">
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Learning Java</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Understanding PaperMC APIs</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Exploring plugin architecture</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Creating first projects</li>
                                        </ul>
                                    </div>
                                </div>

                                <div className="bg-[#2C2E31] border border-[#3A3D42] p-6 sm:p-8 rounded-lg flex flex-col justify-between">
                                    <div>
                                        <h3 className="text-lg font-medium text-[#f4f4f5] mb-3">Experienced Developers</h3>
                                        <p className="text-sm text-[#a1a1aa] leading-relaxed mb-6">
                                            Generate Paper plugin foundations instantly and focus on building unique server mechanics.
                                        </p>
                                    </div>
                                    <div>
                                        <div className="text-xs font-mono uppercase tracking-wider text-[#71717a] mb-3">Great for:</div>
                                        <ul className="space-y-2 text-sm text-[#f4f4f5]">
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Rapid prototyping</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Boilerplate generation</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> paper-plugin.yml & listener setup</li>
                                            <li className="flex items-center gap-2"><span className="text-[#71717a] font-mono">•</span> Internal server tooling</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Examples */}
                    <section id="examples" className="py-20 px-6 border-t border-[#3A3D42]">
                        <div className="max-w-5xl mx-auto">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#f4f4f5] mb-8">
                                What can you build?
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[
                                    { title: "Custom Enchantments", desc: "Create unique player abilities with modern Paper component tooltips and event triggers." },
                                    { title: "Economy System", desc: "Flexible vaults, player-to-player trading, and custom currency handlers." },
                                    { title: "Prison Core", desc: "Automated mine resets, rankup progression trees, and block multipliers." },
                                    { title: "Land Claims", desc: "Protect player builds with visual boundary markers and permission flags." },
                                    { title: "RPG Classes", desc: "Skill progression, custom mana systems, and class-specific abilities." },
                                    { title: "Shop System", desc: "GUI item shops, category navigation, buy/sell prices, and Vault integration." }
                                ].map((item, idx) => (
                                    <div key={idx} className="bg-[#2C2E31] border border-[#3A3D42] p-6 rounded-lg">
                                        <h3 className="text-base font-medium text-[#f4f4f5] mb-2">{item.title}</h3>
                                        <p className="text-sm text-[#a1a1aa] leading-relaxed">{item.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Deliverables / Releases List (Target Section) */}
                    <section className="py-20 px-6 border-t border-[#3A3D42]">
                        <div className="max-w-3xl mx-auto">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#f4f4f5] mb-2">
                                Generated Assets
                            </h2>
                            <p className="text-xs sm:text-sm text-[#a1a1aa] mb-8">
                                Sample release artifacts produced directly by PluginForge.
                            </p>

                            <div className="bg-[#2C2E31] border border-[#3A3D42] rounded-lg overflow-hidden divide-y divide-[#3A3D42]">
                                <div className="p-4 flex items-center gap-3.5 hover:bg-[#3A3D42]/30 transition-colors">
                                    <div className="text-[#a1a1aa] shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm font-medium text-[#f4f4f5]">PrisonCore.jar</span>
                                            <span className="text-[11px] text-[#71717a] font-mono">248 KB</span>
                                        </div>
                                        <p className="text-xs text-[#a1a1aa] mt-0.5">Compiled Paper plugin binary ready for your plugins folder</p>
                                    </div>
                                </div>

                                <div className="p-4 flex items-center gap-3.5 hover:bg-[#3A3D42]/30 transition-colors">
                                    <div className="text-[#a1a1aa] shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm font-medium text-[#f4f4f5]">Guilds.jar</span>
                                            <span className="text-[11px] text-[#71717a] font-mono">182 KB</span>
                                        </div>
                                        <p className="text-xs text-[#a1a1aa] mt-0.5">Territory claims, clan chat channels, and bank integration</p>
                                    </div>
                                </div>

                                <div className="p-4 flex items-center gap-3.5 hover:bg-[#3A3D42]/30 transition-colors">
                                    <div className="text-[#a1a1aa] shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm font-medium text-[#f4f4f5]">Economy.jar</span>
                                            <span className="text-[11px] text-[#71717a] font-mono">115 KB</span>
                                        </div>
                                        <p className="text-xs text-[#a1a1aa] mt-0.5">Vault API provider with player trading and physical currency</p>
                                    </div>
                                </div>

                                <div className="p-4 flex items-center gap-3.5 bg-[#26282B]/40 hover:bg-[#3A3D42]/30 transition-colors">
                                    <div className="text-[#a1a1aa] shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-medium text-[#f4f4f5]">Source code (zip)</span>
                                                <svg className="w-3.5 h-3.5 text-[#a1a1aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                                </svg>
                                            </div>
                                            <span className="text-[11px] font-medium text-[#a1a1aa] bg-[#26282B] border border-[#3A3D42] px-2.5 py-0.5 rounded">
                                                Iron & Diamond tiers
                                            </span>
                                        </div>
                                        <p className="text-xs text-[#a1a1aa] mt-0.5">Readable Java source files, listeners, commands, config.yml, and paper-plugin.yml</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* FAQ */}
                    <section id="faq" className="py-20 px-6 border-t border-[#3A3D42]">
                        <div className="max-w-3xl mx-auto">
                            <h2 className="text-2xl font-semibold tracking-tight text-[#f4f4f5] mb-8">
                                Frequently asked questions
                            </h2>

                            <div className="space-y-3">
                                {[
                                    {
                                        q: "What version of Paper is supported?",
                                        a: "PluginForge exclusively builds plugins targeting PaperMC versions (1.20 through 1.21.x) using Java 17+ and 21 standards.",
                                        icon: (
                                            <svg className="w-4 h-4 text-[#a1a1aa] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25l6.75 6.75 6.75-6.75M12 3v18" />
                                            </svg>
                                        )
                                    },
                                    {
                                        q: "Do I own the generated plugin code?",
                                        a: "Yes. All Java source code, paper-plugin.yml manifests, and compiled JAR binaries are 100% yours to modify, run, or distribute.",
                                        icon: (
                                            <svg className="w-4 h-4 text-[#a1a1aa] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0112 2.714z" />
                                            </svg>
                                        )
                                    },
                                    {
                                        q: "Can I edit the code after it's generated?",
                                        a: "Viewing and editing raw Java source code requires an Iron Tier or Diamond Tier plan. Stone Tier users receive ready-to-run compiled .jar files.",
                                        icon: (
                                            <svg className="w-4 h-4 text-[#a1a1aa] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                            </svg>
                                        )
                                    },
                                    {
                                        q: "How do I install the generated plugin?",
                                        a: "You receive a compiled .jar file designed specifically for Paper servers. Simply place it into your server's /plugins directory and restart.",
                                        icon: (
                                            <svg className="w-4 h-4 text-[#a1a1aa] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                            </svg>
                                        )
                                    },
                                    {
                                        q: "What happens if my plugin has a bug?",
                                        a: "PluginForge automatically runs compile verification and self-healing checks on every generation. If something isn't working as expected, you can re-prompt with the error message to fix it instantly.",
                                        icon: (
                                            <svg className="w-4 h-4 text-[#a1a1aa] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                                            </svg>
                                        )
                                    }
                                ].map((faq, idx) => (
                                    <div key={idx} className="bg-[#2C2E31] border border-[#3A3D42] rounded-lg overflow-hidden">
                                        <button
                                            onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                                            className="w-full p-4 text-left flex items-center justify-between text-sm font-medium text-[#f4f4f5] focus:outline-none hover:bg-[#3A3D42]/50 transition-colors gap-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                {faq.icon}
                                                <span>{faq.q}</span>
                                            </div>
                                            <span className="text-[#a1a1aa] font-mono text-xs shrink-0">{openFaq === idx ? "—" : "+"}</span>
                                        </button>
                                        {openFaq === idx && (
                                            <div className="px-4 pb-4 pl-11 text-sm text-[#a1a1aa] leading-relaxed border-t border-[#3A3D42] pt-3">
                                                {faq.a}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </main>

                {/* Footer */}
                <footer className="py-12 px-6 border-t border-[#3A3D42] text-xs text-[#71717a] text-center">
                    <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
                        <div>PluginForge © {new Date().getFullYear()}</div>
                        <div className="flex items-center gap-6 text-[#a1a1aa]">
                            <button
                                onClick={() => setActiveLegalModal('privacy')}
                                className="hover:text-[#f4f4f5] transition-colors focus:outline-none"
                            >
                                Privacy Policy
                            </button>
                            <button
                                onClick={() => setActiveLegalModal('terms')}
                                className="hover:text-[#f4f4f5] transition-colors focus:outline-none"
                            >
                                Terms of Service
                            </button>
                        </div>
                    </div>
                </footer>

                {/* Legal Modal Component */}
                {activeLegalModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
                        <div className="bg-[#2C2E31] border border-[#3A3D42] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                            <div className="p-5 border-b border-[#3A3D42] flex items-center justify-between bg-[#26282B] shrink-0">
                                <div>
                                    <h3 className="text-base font-semibold text-[#f4f4f5]">
                                        {activeLegalModal === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
                                    </h3>
                                    <p className="text-[11px] font-mono text-[#71717a]">
                                        PluginForge Platform • Effective Date: October 2026
                                    </p>
                                </div>
                                <button
                                    onClick={() => setActiveLegalModal(null)}
                                    className="text-[#a1a1aa] hover:text-[#f4f4f5] p-1.5 rounded-lg bg-[#2C2E31] border border-[#3A3D42] transition-colors"
                                    aria-label="Close modal"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto text-sm text-[#a1a1aa] leading-relaxed space-y-6">
                                {activeLegalModal === 'privacy' ? (
                                    <>
                                        <section className="bg-[#26282B]/60 p-4 rounded-lg border border-[#3A3D42]">
                                            <h4 className="text-xs font-mono uppercase tracking-wider text-[#f4f4f5] font-semibold mb-1">Plain English Summary</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                We only collect what’s needed to build your Minecraft plugins and process your account logins. We never sell your prompt ideas, trade your data, or store your credit card information.
                                            </p>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">1. Data We Collect</h4>
                                            <div className="space-y-2 text-xs text-[#a1a1aa]">
                                                <p><strong className="text-[#f4f4f5]">Account Information:</strong> Your Discord display name, username, profile picture and account ID, received when you sign in with Discord and used for authentication and account management. We never see your Discord password.</p>
                                                <p><strong className="text-[#f4f4f5]">Plugin Generation Prompts:</strong> Text descriptions, custom config rules, and technical specifications you enter to generate code.</p>
                                                <p><strong className="text-[#f4f4f5]">Technical & Diagnostic Logs:</strong> Compilation outputs, Java error traces, IP addresses, browser specs, and request timestamps to prevent abuse and improve performance.</p>
                                                <p><strong className="text-[#f4f4f5]">Payment Details:</strong> Encrypted transaction records and subscription status processed securely via Stripe. We do not store financial credentials.</p>
                                            </div>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">2. How We Use Your Data</h4>
                                            <ul className="list-disc pl-5 space-y-1.5 text-xs text-[#a1a1aa]">
                                                <li>Generating Java source code, plugin manifests (`paper-plugin.yml`), and compiled `.jar` files.</li>
                                                <li>Running automated compile-time error checks and diagnostic self-healing loops.</li>
                                                <li>Enforcing daily and monthly generation limits based on your subscription tier (Stone, Iron, Diamond).</li>
                                                <li>Preventing service abuse, malicious code injection, and denial-of-service attempts.</li>
                                            </ul>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">3. Data Sharing & Third Parties</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                We do not sell, rent, or trade your personal data or prompt inputs. We only share necessary operational data with trusted infrastructure partners: cloud hosting providers (for server execution), AI language model API providers (strictly for processing prompts without training on private data), and Stripe (for secure billing).
                                            </p>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">4. Retention & Your Rights</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                Project histories and generated code are stored while your account remains active. You hold full rights to access, export, or request permanent deletion of your account and associated prompt history at any time by reaching out on our Discord server or via email.
                                            </p>
                                        </section>
                                    </>
                                ) : (
                                    <>
                                        <section className="bg-[#26282B]/60 p-4 rounded-lg border border-[#3A3D42]">
                                            <h4 className="text-xs font-mono uppercase tracking-wider text-[#f4f4f5] font-semibold mb-1">Plain English Summary</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                You own 100% of all plugin code you generate. Don't use PluginForge to build malicious plugins or force-op exploits. Test all generated `.jar` files on a test server before deploying to live players.
                                            </p>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">1. 100% Intellectual Property Ownership</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                You retain <span className="text-[#f4f4f5] font-semibold">complete, unrestricted ownership</span> of all Java source files, config files, `paper-plugin.yml` manifests, and compiled `.jar` binaries produced through your prompts. PluginForge claims zero royalties, licensing rights, or ownership over your plugins. You are free to monetize, distribute, sell, or open-source them without restriction.
                                            </p>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">2. Acceptable Use Policy</h4>
                                            <p className="text-xs text-[#a1a1aa] mb-2">You agree not to use PluginForge to attempt to generate or distribute:</p>
                                            <ul className="list-disc pl-5 space-y-1 text-xs text-[#a1a1aa]">
                                                <li>Malicious backdoors, force-op commands, trojans, or remote access tools targeting Minecraft servers.</li>
                                                <li>Plugins specifically engineered to crash servers, exploit memory leaks, or bypass server security permissions.</li>
                                                <li>Automated bot traffic or scrapers designed to bypass rate limits or compromise system stability.</li>
                                            </ul>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">3. Subscriptions & Tier Allowances</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                Generations are governed by your active tier (Stone: 5/day, Iron: 250/mo, Diamond: 1000/mo). Unused monthly allowances do not roll over. Subscriptions auto-renew until cancelled in your billing portal. Refunds are handled in accordance with our fair-use policy upon request within 7 days of purchase.
                                            </p>
                                        </section>

                                        <section>
                                            <h4 className="text-sm font-semibold text-[#f4f4f5] mb-2">4. Disclaimers & Safety Advisory</h4>
                                            <p className="text-xs text-[#a1a1aa]">
                                                PluginForge provides generated files on an <span className="text-[#f4f4f5] font-semibold">"AS IS"</span> basis. While automated compile checks ensure code validity, server owners are responsible for testing generated plugins on a staging server before running them on production servers with real players. PluginForge is not affiliated with Mojang Studios, Microsoft, or PaperMC.
                                            </p>
                                        </section>
                                    </>
                                )}
                            </div>
                            <div className="p-4 border-t border-[#3A3D42] bg-[#26282B] flex items-center justify-between shrink-0">
                                <span className="text-xs text-[#71717a]">
                                    Need help? Join our <a href="https://discord.gg/tBYx3QkwhH" target="_blank" rel="noopener noreferrer" className="text-[#f4f4f5] underline hover:text-[#a1a1aa]">Discord Community</a>
                                </span>
                                <button
                                    onClick={() => setActiveLegalModal(null)}
                                    className="bg-[#2C2E31] hover:bg-[#3A3D42] border border-[#3A3D42] text-[#f4f4f5] text-xs font-semibold px-5 py-2 rounded transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }


    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
