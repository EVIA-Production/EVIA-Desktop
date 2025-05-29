import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { promptService, SystemPrompt } from '@/services/promptService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PromptsManagement = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [newPrompt, setNewPrompt] = useState<Omit<SystemPrompt, 'id' | 'created_at' | 'updated_at'>>({
    name: '',
    description: '',
    content: '',
    is_active: false,
  });
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isLoading) return;
    
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!user?.is_admin) {
      navigate('/');
      return;
    }

    fetchPrompts();
  }, [isAuthenticated, isLoading, user, navigate]);

  const fetchPrompts = async () => {
    try {
      setIsLoadingPrompts(true);
      const data = await promptService.getPrompts();
      setPrompts(data);
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
      toast({
        title: "Error",
        description: "Failed to fetch prompts",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPrompts(false);
    }
  };

  const handleAddPrompt = async () => {
    try {
      // Call the service to create the prompt
      await promptService.createPrompt(newPrompt);

      // Close dialog and reset form
      setIsAddDialogOpen(false);
      setNewPrompt({ name: '', description: '', content: '', is_active: false });

      // Refetch prompts to get the newly created one and update list
      fetchPrompts();
      
      toast({
        title: "Success",
        description: "Prompt added successfully",
      });
    } catch (error) {
      console.error('Failed to add prompt:', error);
      toast({
        title: "Error",
        description: "Failed to add prompt",
        variant: "destructive",
      });
    }
  };

  const handleEditPrompt = async () => {
    if (!editingPrompt) return;
    
    try {
      const updatedPrompt = await promptService.updatePrompt(editingPrompt.id.toString(), editingPrompt);
      setPrompts(prompts.map(p => 
        p.id === updatedPrompt.id 
          ? updatedPrompt
          : p
      ));
      setEditingPrompt(null);
      setIsEditDialogOpen(false);
      toast({
        title: "Success",
        description: "Prompt updated successfully",
      });
    } catch (error) {
      console.error('Failed to update prompt:', error);
      toast({
        title: "Error",
        description: "Failed to update prompt",
        variant: "destructive",
      });
    }
  };

  const handleDeletePrompt = async (id: string) => {
    try {
      await promptService.deletePrompt(id);
      setPrompts(prompts.filter(p => p.id !== id));
      toast({
        title: "Success",
        description: "Prompt deleted successfully",
      });
    } catch (error) {
      console.error('Failed to delete prompt:', error);
      toast({
        title: "Error",
        description: "Failed to delete prompt",
        variant: "destructive",
      });
    }
  };

  const handleToggleActive = async (id: string) => {
    const promptToToggle = prompts.find(p => p.id === id);
    if (!promptToToggle) return;

    try {
      // Call the service to set the active status
      await promptService.setActiveStatus(id, !promptToToggle.is_active);

      // Refetch prompts to get the updated active status for all prompts
      fetchPrompts(); 
      
      toast({
        title: "Success",
        description: "Active prompt updated successfully",
      });
    } catch (error) {
      console.error('Failed to toggle prompt status:', error);
      toast({
        title: "Error",
        description: "Failed to update active prompt",
        variant: "destructive",
      });
      // If there's an error, refetch prompts to revert optimistic update if necessary
      fetchPrompts(); 
    }
  };

  const filteredPrompts = prompts.filter(prompt => {
    const searchMatch = prompt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        prompt.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        (prompt.description && prompt.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return searchMatch;
  });

  // Sort prompts to show active first
  const sortedPrompts = [...filteredPrompts].sort((a, b) => {
    if (a.is_active && !b.is_active) return -1; // a is active, b is not: a comes first
    if (!a.is_active && b.is_active) return 1;  // b is active, a is not: b comes first
    return 0; // both are active or inactive: maintain original order
  });

  if (isLoading || isLoadingPrompts) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Button
              variant="ghost"
              className="mb-4"
              onClick={() => navigate('/admin')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-4xl font-bold text-white mb-2">Manage Prompts</h1>
            <p className="text-gray-400">Create and manage system prompts</p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Prompt
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Prompt</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={newPrompt.name}
                    onChange={(e) => setNewPrompt({ ...newPrompt, name: e.target.value })}
                    placeholder="Enter prompt name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={newPrompt.description || ''}
                    onChange={(e) => setNewPrompt({ ...newPrompt, description: e.target.value })}
                    placeholder="Enter prompt description"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    value={newPrompt.content}
                    onChange={(e) => setNewPrompt({ ...newPrompt, content: e.target.value })}
                    placeholder="Enter prompt content"
                    className="min-h-[100px]"
                  />
                </div>
                <Button onClick={handleAddPrompt} className="w-full">
                  Add Prompt
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mb-6 w-full">
          <Input
            placeholder="Search prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="space-y-4">
          {sortedPrompts.map((prompt) => (
            <div key={prompt.id} className={`bg-card/50 rounded-lg border border-border p-4 flex items-center justify-between ${prompt.is_active ? 'border-primary/50 bg-primary/10' : ''}`}>
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-semibold">{prompt.name}</h3>
                  {prompt.is_active && (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                </div>
                <p className="text-gray-400 text-sm truncate">{prompt.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleActive(prompt.id)}
                  className={prompt.is_active ? 'text-primary' : ''}
                >
                  {prompt.is_active ? 'Active' : 'Set Active'}
                </Button>
                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingPrompt(prompt)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Prompt</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Name</label>
                        <Input
                          value={editingPrompt?.name || ''}
                          onChange={(e) => setEditingPrompt(editingPrompt ? { ...editingPrompt, name: e.target.value } : null)}
                          placeholder="Enter prompt name"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Description</label>
                        <Input
                          value={editingPrompt?.description || ''}
                          onChange={(e) => setEditingPrompt(editingPrompt ? { ...editingPrompt, description: e.target.value } : null)}
                          placeholder="Enter prompt description"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Content</label>
                        <Textarea
                          value={editingPrompt?.content || ''}
                          onChange={(e) => setEditingPrompt(editingPrompt ? { ...editingPrompt, content: e.target.value } : null)}
                          placeholder="Enter prompt content"
                          className="min-h-[100px]"
                        />
                      </div>
                      <Button onClick={handleEditPrompt} className="w-full">
                        Save Changes
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeletePrompt(prompt.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default PromptsManagement; 