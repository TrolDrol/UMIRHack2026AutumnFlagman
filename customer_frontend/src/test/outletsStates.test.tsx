// Component state tests only; live publication/card navigation is tested separately.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Outlets } from "../pages/Outlets";
const state=vi.hoisted(()=>({query:{} as Record<string,unknown>}));
vi.mock("../shared/api/queries",()=>({useOutlets:()=>state.query}));
afterEach(cleanup);
function show(overrides:Record<string,unknown>={}){state.query={isPending:false,isError:false,isSuccess:true,isFetching:false,refetch:vi.fn(),data:[],...overrides};render(<MemoryRouter><Outlets/></MemoryRouter>);}
it("first loading does not claim an empty successful result",()=>{show({isPending:true,isSuccess:false,data:undefined});expect(screen.getByRole("status")).toHaveTextContent("Загружаем");expect(screen.queryByText("Пока нет доступных заведений.")).not.toBeInTheDocument();});
it.each(["401: войдите снова","503: сервер недоступен","Ответ API не соответствует контракту."])("error without data stays an error: %s",message=>{show({isError:true,isSuccess:false,data:undefined,error:new Error(message)});expect(screen.getByRole("alert")).toHaveTextContent(message);expect(screen.queryByText("Пока нет доступных заведений.")).not.toBeInTheDocument();});
it("successful empty result has an explicit refresh action",()=>{show();expect(screen.getByText("Пока нет доступных заведений.")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Обновить"}));expect(state.query.refetch).toHaveBeenCalledOnce();});
it("failed empty-cache refresh does not claim no outlets",()=>{show({isError:true,isSuccess:false,error:new Error("offline")});expect(screen.getByText(/Данные могли устареть/)).toBeInTheDocument();expect(screen.queryByText("Пока нет доступных заведений.")).not.toBeInTheDocument();});
it("background failure retains real cached card with stale warning and warehouse link",()=>{show({isError:true,isSuccess:false,error:new Error("offline"),data:[{warehouseId:"warehouse-123",name:"Restaurant",timeZone:"Europe/Moscow"}]});expect(screen.getByRole("link")).toHaveAttribute("href","/outlets/warehouse-123/menu");expect(screen.getByText(/Данные могли устареть/)).toBeInTheDocument();});
