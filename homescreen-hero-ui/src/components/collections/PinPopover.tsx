import { useState } from "react";
import { Pin, Home, Users, Star } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";

export type VisibilityOptions = {
    home: boolean;
    shared: boolean;
    recommended: boolean;
};

// Shared pin popover used by both card and list views
export default function PinPopover({
    isPinned,
    isPinning,
    onPinWithVisibility,
    onUnpin,
}: {
    isPinned: boolean;
    isPinning: boolean;
    onPinWithVisibility: (visibility: VisibilityOptions) => void;
    onUnpin: () => void;
}) {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [visibility, setVisibility] = useState<VisibilityOptions>({
        home: true,
        shared: false,
        recommended: false,
    });

    const handlePin = () => {
        onPinWithVisibility(visibility);
        setPopoverOpen(false);
    };

    const handleUnpin = () => {
        onUnpin();
        setPopoverOpen(false);
    };

    const handleOpenChange = (open: boolean) => {
        if (open) {
            setVisibility({ home: true, shared: false, recommended: false });
        }
        setPopoverOpen(open);
    };

    return (
        <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    disabled={isPinning}
                    className={`p-2 rounded-lg transition-colors ${
                        isPinned
                            ? "bg-primary/80 hover:bg-primary text-white"
                            : "bg-slate-800/70 hover:bg-slate-700/90 text-slate-300"
                    } disabled:opacity-50`}
                    title={isPinned ? "Edit pin settings" : "Pin to home"}
                    onClick={(e) => e.stopPropagation()}
                >
                    <Pin size={16} className={isPinned ? "fill-current" : ""} />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-44 p-2.5 bg-slate-900/90 backdrop-blur-md border-slate-700/50"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="space-y-1.5">
                    <label className="flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer hover:bg-white/5 transition-colors">
                        <input
                            type="checkbox"
                            checked={visibility.home}
                            onChange={(e) => setVisibility(v => ({ ...v, home: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800/50 text-primary focus:ring-1 focus:ring-primary/50 focus:ring-offset-0"
                        />
                        <Home size={12} className="text-slate-500" />
                        <span className="text-xs text-slate-300">My Home</span>
                    </label>

                    <label className="flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer hover:bg-white/5 transition-colors">
                        <input
                            type="checkbox"
                            checked={visibility.shared}
                            onChange={(e) => setVisibility(v => ({ ...v, shared: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800/50 text-primary focus:ring-1 focus:ring-primary/50 focus:ring-offset-0"
                        />
                        <Users size={12} className="text-slate-500" />
                        <span className="text-xs text-slate-300">Shared</span>
                    </label>

                    <label className="flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer hover:bg-white/5 transition-colors">
                        <input
                            type="checkbox"
                            checked={visibility.recommended}
                            onChange={(e) => setVisibility(v => ({ ...v, recommended: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800/50 text-primary focus:ring-1 focus:ring-primary/50 focus:ring-offset-0"
                        />
                        <Star size={12} className="text-slate-500" />
                        <span className="text-xs text-slate-300">Recommended</span>
                    </label>

                    <div className="pt-1.5 flex gap-1.5">
                        {isPinned ? (
                            <>
                                <button
                                    onClick={handleUnpin}
                                    disabled={isPinning}
                                    className="flex-1 px-2 py-1 text-[10px] font-medium rounded-md border border-slate-600/50 text-slate-400 hover:bg-slate-800/50 hover:text-white transition-colors disabled:opacity-50"
                                >
                                    Unpin
                                </button>
                                <button
                                    onClick={handlePin}
                                    disabled={isPinning || (!visibility.home && !visibility.shared && !visibility.recommended)}
                                    className="flex-1 px-2 py-1 text-[10px] font-medium rounded-md bg-primary/90 hover:bg-primary text-white transition-colors disabled:opacity-50"
                                >
                                    Update
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={handlePin}
                                disabled={isPinning || (!visibility.home && !visibility.shared && !visibility.recommended)}
                                className="w-full px-2 py-1 text-[10px] font-medium rounded-md bg-primary/90 hover:bg-primary text-white transition-colors disabled:opacity-50"
                            >
                                Pin
                            </button>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
