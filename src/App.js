import Editor from "./Editor.js";
import Sidebar from "./Sidebar.js";
import router from "./router.js";
import { asyncDataObj, request } from "./api.js";
import { setItem, getItem, removeItem } from "./storage.js";
import { compareObject, getLocalSaveKey } from "./utility.js";
import Indicator from "./Indicator.js";

export default function App({ targetEl }) {
  this.isInit = false;

  this.state = {
    selectedDocumentId: null,
    documents: { ...asyncDataObj, isLoading: true },
    document: { ...asyncDataObj },
  };

  this.setState = (nextState) => {
    const prevState = JSON.parse(JSON.stringify(this.state));

    if (compareObject(prevState, nextState).isDifferent) {
      this.state = nextState;

      // 선택된 문서가 변경된 경우, 문서 목록이 변경된 경우
      if (
        compareObject(
          prevState.selectedDocumentId,
          nextState.selectedDocumentId
        ).isDifferent ||
        compareObject(prevState.documents, nextState.documents).isDifferent
      ) {
        sidebar.setState({
          selectedDocumentId: this.state.selectedDocumentId,
          documents: this.state.documents,
        });
      }

      // 항상
      editor.setState({ ...this.state });

      // 문서가 변경된 경우, 문서 목록이 변경된 경우
      if (
        compareObject(prevState.documents, nextState.documents).isDifferent ||
        compareObject(prevState.document, nextState.document).isDifferent
      ) {
        indicator.setState(
          this.state.document.isLoading || this.state.documents.isLoading
        );
      }

      this.render();
    }
  };

  let serverUpdateTimer = null;
  let localSaveTimer = null;
  let optimisticUpdateTimer = null;

  const indicator = new Indicator({
    targetEl,
    initialState: false,
  });

  const sidebar = new Sidebar({
    targetEl,
    initialState: {
      selectedDocumentId: this.state.selectedDocumentId,
      documents: this.state.documents,
    },
    onCreate: async (parent) => {
      const res = await createDocument(parent);

      await fetchDocuments();

      if (res.id) {
        router.push(`/documents/${res.id}`);
      } else {
        throw new Error("문서 생성 과정에서 에러가 발생하였습니다!");
      }
    },
    onDelete: async (id) => {
      const res = await deleteDocument(id);
      router.replace(res.parent?.id ? `/documents/${res.parent.id}` : "/");
      await fetchDocuments();
    },
  });

  const editor = new Editor({
    targetEl,
    initialState: { ...this.state },
    onEditing: (document) => {
      clearTimeout(serverUpdateTimer);
      clearTimeout(localSaveTimer);
      clearTimeout(optimisticUpdateTimer);
      serverUpdateTimer = setTimeout(async () => {
        await updateDocument(document);

        const LOCAL_SAVE_KEY = getLocalSaveKey(document.id);
        removeItem(LOCAL_SAVE_KEY);

        await fetchDocument(document.id);

        await fetchDocuments();
      }, 3000);
      localSaveTimer = setTimeout(async () => {
        localSaveDocument(document);
      }, 250);
      optimisticUpdateTimer = setTimeout(async () => {
        optimisticUpdate(document);
      }, 50);
    },
  });

  const optimisticUpdate = async ({ id, title }) => {
    const newData = JSON.parse(JSON.stringify(this.state.documents.data));

    function recursion(id, documents, title) {
      for (const document of documents) {
        if (document.id === id) {
          if (document.title !== title) {
            document.title = title;
          }
          return null;
        }
        if (document.documents && document.documents.length > 0) {
          recursion(id, document.documents, title);
        }
      }
    }

    await recursion(id, newData, title);

    this.setState({
      ...this.state,
      documents: {
        ...asyncDataObj,
        data: newData,
      },
    });
  };

  const fetchDocuments = async () => {
    try {
      const res = await request("/documents");

      this.setState({
        ...this.state,
        documents: { ...asyncDataObj, data: res },
      });
    } catch (e) {
      this.setState({
        ...this.state,
        documents: { ...asyncDataObj, isError: e },
      });
    }
  };

  const fetchDocument = async (id) => {
    if (id === null) {
      this.setState({
        ...this.state,
        document: { ...asyncDataObj },
      });

      return null;
    }

    if (id !== this.state.document.data?.id) {
      this.setState({
        ...this.state,
        document: { ...asyncDataObj, isLoading: true },
      });
    }

    const LOCAL_SAVE_KEY = getLocalSaveKey(id);
    const storedData = getItem(LOCAL_SAVE_KEY, false);

    try {
      const res = await request(`/documents/${id.toString()}`);

      const savedAt = new Date(storedData.localSaveDate).getTime();
      const updatedAt = new Date(res.updatedAt).getTime();

      if (
        savedAt > updatedAt &&
        window.confirm("로컬에 저장된 최신 정보가 있습니다. 가져오시겠습니까?")
      ) {
        delete storedData.localSaveDate;

        this.setState({
          ...this.state,
          document: { ...asyncDataObj, data: storedData },
        });
      } else {
        this.setState({
          ...this.state,
          document: { ...asyncDataObj, data: res },
        });
      }

      this.setState({
        ...this.state,
        document: {
          ...asyncDataObj,
          data: savedAt > updatedAt ? storedData : res,
        },
      });
    } catch (e) {
      this.setState({
        ...this.state,
        document: { ...asyncDataObj, isError: e },
      });
    }
  };

  const updateDocument = async (document) => {
    const { id, title, content } = document;

    const body = { title, content };

    const res = await request(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return res;
  };

  const createDocument = async (parent) => {
    const body = { title: "", parent };

    const res = await request(`/documents`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return res;
  };

  const deleteDocument = async (id) => {
    if (!id || typeof id !== "number") {
      throw new Error("삭제할 문서의 id를 입력하세요!");
    }

    const res = await request(`/documents/${id}`, { method: "DELETE" });

    return res;
  };

  const localSaveDocument = async (document) => {
    if (
      this.state.document.data.id === document.id &&
      (this.state.document.data.title !== document.title ||
        this.state.document.data.content !== document.content)
    ) {
      const LOCAL_SAVE_KEY = getLocalSaveKey(document.id);
      setItem(LOCAL_SAVE_KEY, { ...document, localSaveDate: new Date() });
    }
  };

  const menualUpdateDocument = async (e) => {
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();

      await updateDocument(editor.state.document.data);

      const LOCAL_SAVE_KEY = getLocalSaveKey(editor.state.document.data.id);
      removeItem(LOCAL_SAVE_KEY);

      await fetchDocument(editor.state.document.data.id);
      await fetchDocuments();
    }
  };

  const onRouterChange = (pathname) => {
    const arr = pathname.substring(1).split("/");
    const id = arr.length > 1 ? Number(arr[1]) : null;

    if (this.state.selectedDocumentId !== id) {
      this.setState({
        ...this.state,
        selectedDocumentId: id,
      });
      fetchDocument(id);
    }

    clearTimeout(serverUpdateTimer);
    clearTimeout(localSaveTimer);
    clearTimeout(optimisticUpdateTimer);
  };

  this.render = () => {
    if (!this.isInit) {
      router.init(onRouterChange);
      onRouterChange(window.location.pathname);
      window.addEventListener("keydown", menualUpdateDocument);

      indicator.render();
      sidebar.render();
      editor.render();

      fetchDocuments();

      this.isInit = true;
    }
  };

  this.render();
}
