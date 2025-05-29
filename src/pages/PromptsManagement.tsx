import React, { useState } from 'react';
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

interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

// Mock data
const mockPrompts: Prompt[] = [
  {
    id: '1',
    name: 'General Assistant',
    description: 'A helpful assistant for general questions',
    content: 'You are a helpful assistant that provides clear and concise answers.',
    createdAt: '2024-03-15T10:00:00Z',
    updatedAt: '2024-03-15T10:00:00Z',
    isActive: true,
  },
  {
    id: '2',
    name: 'Code Expert',
    description: 'Specialized in programming and technical questions',
    content: 'You are a programming expert that helps with code-related questions.',
    createdAt: '2024-03-15T11:00:00Z',
    updatedAt: '2024-03-15T11:00:00Z',
    isActive: false,
  },
];

const PromptsManagement = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<Prompt[]>(mockPrompts);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [newPrompt, setNewPrompt] = useState<Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>>({
    name: '',
    description: '',
    content: '',
    isActive: false,
  });

  React.useEffect(() => {
    if (isLoading) return;
    
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!user?.is_admin) {
      navigate('/');
      return;
    }
  }, [isAuthenticated, isLoading, user, navigate]);

  const handleAddPrompt = () => {
    const prompt: Prompt = {
      id: Math.random().toString(36).substr(2, 9),
      ...newPrompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPrompts([...prompts, prompt]);
    setNewPrompt({ name: '', description: '', content: '', isActive: false });
    setIsAddDialogOpen(false);
    toast({
      title: "Success",
      description: "Prompt added successfully",
    });
  };

  const handleEditPrompt = () => {
    if (!editingPrompt) return;
    
    setPrompts(prompts.map(p => 
      p.id === editingPrompt.id 
        ? { ...editingPrompt, updatedAt: new Date().toISOString() }
        : p
    ));
    setEditingPrompt(null);
    setIsEditDialogOpen(false);
    toast({
      title: "Success",
      description: "Prompt updated successfully",
    });
  };

  const handleDeletePrompt = (id: string) => {
    setPrompts(prompts.filter(p => p.id !== id));
    toast({
      title: "Success",
      description: "Prompt deleted successfully",
    });
  };

  const handleToggleActive = (id: string) => {
    setPrompts(prompts.map(p => ({
      ...p,
      isActive: p.id === id ? !p.isActive : false
    })));
    toast({
      title: "Success",
      description: "Active prompt updated successfully",
    });
  };

  if (isLoading) {
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
                    value={newPrompt.description}
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

        <div className="bg-card/50 rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prompts.map((prompt) => (
                <TableRow key={prompt.id} className={prompt.isActive ? 'bg-primary/10' : ''}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {prompt.name}
                      {prompt.isActive && (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{prompt.description}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(prompt.id)}
                        className={prompt.isActive ? 'text-primary' : ''}
                      >
                        {prompt.isActive ? 'Active' : 'Set Active'}
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
};

export default PromptsManagement; 